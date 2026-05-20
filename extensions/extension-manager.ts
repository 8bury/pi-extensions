import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Container, type SettingItem, SettingsList, Text } from "@earendil-works/pi-tui";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";

type Scope = "user" | "project";
type PackageSetting = string | { source: string; extensions?: string[]; [key: string]: unknown };

interface SettingsFile {
  extensions?: string[];
  packages?: PackageSetting[];
  [key: string]: unknown;
}

interface ExtensionItem {
  id: string;
  label: string;
  description: string;
  scope: Scope;
  path: string;
  enabled: boolean;
  kind: "top-level" | "package";
  source?: string;
  packageRoot?: string;
  pattern: string;
}

const AGENT_DIR = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");

function settingsPath(scope: Scope, cwd: string): string {
  return scope === "user" ? join(AGENT_DIR, "settings.json") : join(cwd, ".pi", "settings.json");
}

function readSettings(scope: Scope, cwd: string): SettingsFile {
  const path = settingsPath(scope, cwd);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SettingsFile;
  } catch {
    return {};
  }
}

function writeSettings(scope: Scope, cwd: string, settings: SettingsFile): void {
  writeFileSync(settingsPath(scope, cwd), JSON.stringify(settings, null, 2) + "\n");
}

function stripMarker(pattern: string): string {
  return pattern.startsWith("+") || pattern.startsWith("-") || pattern.startsWith("!")
    ? pattern.slice(1)
    : pattern;
}

function markerFor(patterns: string[] | undefined, pattern: string): string | undefined {
  const found = [...(patterns ?? [])].reverse().find((p) => stripMarker(p) === pattern);
  return found?.[0];
}

function setMarkedPattern(patterns: string[] | undefined, pattern: string, enabled: boolean): string[] {
  const kept = (patterns ?? []).filter((p) => stripMarker(p) !== pattern);
  kept.push(`${enabled ? "+" : "-"}${pattern}`);
  return kept;
}

function listTopLevel(scope: Scope, cwd: string): ExtensionItem[] {
  const baseDir = scope === "user" ? AGENT_DIR : join(cwd, ".pi");
  const extDir = join(baseDir, "extensions");
  const settings = readSettings(scope, cwd);
  const items: ExtensionItem[] = [];

  const addFile = (file: string) => {
    const pattern = relative(baseDir, file);
    const marker = markerFor(settings.extensions, pattern);
    const parent = basename(dirname(file));
    const fileName = basename(file);
    items.push({
      id: `${scope}:top:${file}`,
      label: parent === "extensions" ? fileName : `${parent}/${fileName}`,
      description: `${scope} · ${file}`,
      scope,
      path: file,
      enabled: marker !== "-",
      kind: "top-level",
      pattern,
    });
  };

  if (existsSync(extDir)) {
    for (const entry of readdirSync(extDir, { withFileTypes: true })) {
      const full = join(extDir, entry.name);
      if (entry.isFile() && /\.[cm]?[jt]s$/.test(entry.name)) addFile(full);
      if (entry.isDirectory()) {
        for (const name of ["index.ts", "index.js", "index.mts", "index.mjs", "index.cts", "index.cjs"]) {
          const index = join(full, name);
          if (existsSync(index)) {
            addFile(index);
            break;
          }
        }
      }
    }
  }

  // Also show explicit extension paths from settings that are not +/- filters.
  for (const configured of settings.extensions ?? []) {
    if (["+", "-", "!"].includes(configured[0] ?? "")) continue;
    const full = resolve(baseDir, configured);
    if (items.some((i) => i.path === full)) continue;
    items.push({
      id: `${scope}:top:${full}`,
      label: basename(full),
      description: `${scope} settings · ${full}`,
      scope,
      path: full,
      enabled: true,
      kind: "top-level",
      pattern: configured,
    });
  }

  return items;
}

function packageRootFor(source: string, scope: Scope, cwd: string): string | undefined {
  if (source.startsWith("npm:")) {
    const spec = source.slice(4).replace(/@[^/@]+$/, "");
    const root = scope === "user" ? join(AGENT_DIR, "npm", "node_modules") : join(cwd, ".pi", "npm", "node_modules");
    return join(root, spec);
  }
  return undefined;
}

function manifestExtensionFiles(pkgRoot: string): string[] {
  const pkgJsonPath = join(pkgRoot, "package.json");
  if (!existsSync(pkgJsonPath)) return [];
  let manifest: any;
  try {
    manifest = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
  } catch {
    return [];
  }

  const entries: string[] = manifest.pi?.extensions ?? ["extensions"];
  const files: string[] = [];
  for (const entry of entries) {
    const full = resolve(pkgRoot, entry);
    if (!existsSync(full)) continue;
    const statEntries = readdirSync(dirname(full), { withFileTypes: true });
    if (statEntries.some((e) => e.name === basename(full) && e.isFile())) {
      files.push(full);
    } else if (statEntries.some((e) => e.name === basename(full) && e.isDirectory())) {
      for (const child of readdirSync(full, { withFileTypes: true })) {
        if (child.isFile() && /\.[cm]?[jt]s$/.test(child.name)) files.push(join(full, child.name));
      }
    }
  }
  return files;
}

function listPackageExtensions(scope: Scope, cwd: string): ExtensionItem[] {
  const settings = readSettings(scope, cwd);
  const items: ExtensionItem[] = [];
  for (const pkgSetting of settings.packages ?? []) {
    const source = typeof pkgSetting === "string" ? pkgSetting : pkgSetting.source;
    const root = packageRootFor(source, scope, cwd);
    if (!root || !existsSync(root)) continue;
    const filters = typeof pkgSetting === "string" ? undefined : pkgSetting.extensions;
    for (const file of manifestExtensionFiles(root)) {
      const pattern = relative(root, file);
      const marker = markerFor(filters, pattern);
      items.push({
        id: `${scope}:pkg:${source}:${file}`,
        label: `${source}: ${relative(root, file)}`,
        description: `${scope} package · ${file}`,
        scope,
        path: file,
        enabled: marker !== "-",
        kind: "package",
        source,
        packageRoot: root,
        pattern,
      });
    }
  }
  return items;
}

function listExtensions(cwd: string): ExtensionItem[] {
  return [...listTopLevel("user", cwd), ...listTopLevel("project", cwd), ...listPackageExtensions("user", cwd), ...listPackageExtensions("project", cwd)].sort((a, b) => a.label.localeCompare(b.label));
}

function setExtensionEnabled(item: ExtensionItem, cwd: string, enabled: boolean): void {
  const settings = readSettings(item.scope, cwd);
  if (item.kind === "top-level") {
    settings.extensions = setMarkedPattern(settings.extensions, item.pattern, enabled);
  } else if (item.source) {
    const packages = [...(settings.packages ?? [])];
    const idx = packages.findIndex((pkg) => (typeof pkg === "string" ? pkg : pkg.source) === item.source);
    if (idx >= 0) {
      const pkg = typeof packages[idx] === "string" ? { source: packages[idx] as string } : { ...(packages[idx] as any) };
      pkg.extensions = setMarkedPattern(pkg.extensions, item.pattern, enabled);
      packages[idx] = pkg;
      settings.packages = packages;
    }
  }
  writeSettings(item.scope, cwd, settings);
}

export default function extensionManager(pi: ExtensionAPI) {
  pi.registerCommand("extensions", {
    description: "Enable/disable pi extensions without deleting them",
    handler: async (_args, ctx) => {
      let extensions = listExtensions(ctx.cwd);
      if (extensions.length === 0) {
        ctx.ui.notify("No extensions found.", "warning");
        return;
      }

      await ctx.ui.custom((_tui, theme, _kb, done) => {
        const container = new Container();
        container.addChild(new Text(theme.fg("accent", theme.bold("Extension Configuration")), 1, 0));
        container.addChild(new Text(theme.fg("dim", "Toggle active/disabled. Changes apply after /reload or restart."), 1, 0));

        const items: SettingItem[] = extensions.map((ext) => ({
          id: ext.id,
          label: ext.label,
          description: ext.description,
          currentValue: ext.enabled ? "active" : "disabled",
          values: ["active", "disabled"],
        }));

        const list = new SettingsList(
          items,
          Math.min(Math.max(items.length + 3, 8), 22),
          getSettingsListTheme(),
          (id, newValue) => {
            const ext = extensions.find((e) => e.id === id);
            if (!ext) return;
            ext.enabled = newValue === "active";
            setExtensionEnabled(ext, ctx.cwd, ext.enabled);
            list.updateValue(id, newValue);
            ctx.ui.notify(`${ext.label} ${newValue}. Run /reload to apply.`, "info");
          },
          () => done(undefined),
          { enableSearch: true },
        );
        container.addChild(list);

        return {
          render: (width: number) => container.render(width),
          invalidate: () => container.invalidate(),
          handleInput: (data: string) => {
            list.handleInput(data);
            _tui.requestRender();
          },
        };
      });
    },
  });
}

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * /clear command for pi.
 *
 * Starts a fresh empty session, equivalent to clearing the current chat/context.
 */
export default function (pi: ExtensionAPI) {
	pi.registerCommand("clear", {
		description: "Clear the current chat/context by starting a fresh empty session",
		handler: async (_args, ctx) => {
			await ctx.waitForIdle();

			const parentSession = ctx.sessionManager.getSessionFile();
			const result = await ctx.newSession({ parentSession });

			if (result.cancelled) {
				ctx.ui.notify("Clear cancelled", "info");
			}
		},
	});
}

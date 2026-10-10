/** Astro renders requests; RunWield owns HTTP serving and static-asset policy. */
import type { AstroIntegration } from "astro";

export default function bunAdapter(): AstroIntegration {
    return {
        name: "runwield/bun-workspace",
        hooks: {
            "astro:config:done": ({ setAdapter }) => {
                setAdapter({
                    name: "runwield/bun-workspace",
                    entrypointResolution: "auto",
                    serverEntrypoint: new URL("./bun-server-entry.ts", import.meta.url).href,
                    supportedAstroFeatures: {
                        hybridOutput: "stable",
                        staticOutput: "stable",
                        serverOutput: "stable",
                        sharpImageService: "stable",
                    },
                });
            },
        },
    };
}

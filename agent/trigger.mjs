// Triggers the charybdis workflow via the GitHub Actions dispatch API.
// Run by an external scheduler every 4h because GitHub's own `schedule:`
// trigger is unreliable and frequently skips. Needs GH_TOKEN in the env.
const res = await fetch(
    "https://api.github.com/repos/longicollis-labs/polyascus-gregaria/actions/workflows/charybdis.yml/dispatches",
    {
        method: "POST",
        headers: {
            Authorization: `Bearer ${process.env.GH_TOKEN}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "charybdis-external-cron",
        },
        body: JSON.stringify({ref: "main"}),
    },
);
console.log("dispatch status:", res.status);
if (!res.ok) {
    console.error(await res.text());
    process.exit(1);
}

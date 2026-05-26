// X renders no markdown. Asterisks, underscores and backticks post as literal
// characters — `*faster*` shows up as "*faster*", not emphasis. The model picks
// the habit up from this agent's own prompt (which is dense with *italic* and
// **bold** for the human reader), so strip every formatting marker from outgoing
// text. Unwrap emphasis to keep the words; nuke any stray asterisks that remain.
export function stripMarkdown(s: string): string {
    return s
        .replace(/(\*\*\*|___)([^\s].*?[^\s]|\S)\1/g, "$2") // ***bold italic*** / ___ ___
        .replace(/(\*\*|__)([^\s].*?[^\s]|\S)\1/g, "$2") //     **bold**         / __ __
        .replace(/(\*|_)([^\s].*?[^\s]|\S)\1/g, "$2") //          *italic*         / _ _
        .replace(/~~([^\s].*?[^\s]|\S)~~/g, "$1") //              ~~strike~~
        .replace(/`([^`]+)`/g, "$1") //                          `code`
        .replace(/\*+/g, "") //                                  any orphaned asterisks
        .replace(/[ \t]{2,}/g, " ") //                           tidy spaces an unwrap left behind
        .trim();
}

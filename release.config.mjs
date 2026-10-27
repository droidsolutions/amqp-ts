import createPreset from "conventional-changelog-angular";

const TRAILER = /^(co-authored-by|signed-off-by|claude-session|reviewed-by|helped-by):/i;

/**
 * The commit parser appends every line after a BREAKING CHANGE note to that note, so git trailers would end up in the
 * release notes. Remove them from note text (commits themselves keep their trailers).
 *
 * @param {string} text
 * @returns {string}
 */
export function stripTrailers(text) {
  return text
    .split("\n")
    .filter((line) => !TRAILER.test(line))
    .join("\n")
    .replace(/\s+$/, "");
}

const { writer } = await createPreset();

/**
 * The angular preset does not know the `!` that marks a breaking change in the header (`feat!: …`): such commits got
 * no type and showed up unsorted at the top of the release notes. Accept it, and treat a `!` without a
 * `BREAKING CHANGE:` footer as breaking as well.
 */
const parserOpts = {
  headerPattern: /^(\w*)(?:\((.*)\))?!?: (.*)$/,
  breakingHeaderPattern: /^(\w*)(?:\((.*)\))?!: (.*)$/,
};

export default {
  branches: [
    "main",
    "master",
    {
      name: "develop",
      prerelease: true,
    },
  ],
  plugins: [
    ["@semantic-release/commit-analyzer", { parserOpts }],
    [
      "@semantic-release/release-notes-generator",
      {
        parserOpts,
        writerOpts: {
          transform: (commit, context) =>
            writer.transform(
              {
                ...commit,
                notes: (commit.notes ?? []).map((note) => ({ ...note, text: stripTrailers(note.text) })),
              },
              context,
            ),
        },
      },
    ],
    "@semantic-release/changelog",
    "@semantic-release/npm",
    "@semantic-release/github",
    "@semantic-release/git",
  ],
};

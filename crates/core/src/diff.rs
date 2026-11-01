//! Parses the per-file patches that GitHub returns for a pull request.
//!
//! GitHub accepts review comments only on lines that appear in the diff. This
//! module records those lines on the new (RIGHT) side of each file.

use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineKind {
    Added,
    Context,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiffLine {
    pub kind: LineKind,
    /// Index of the hunk in the file. Multi-line comments must stay in one hunk.
    pub hunk: usize,
    pub content: String,
}

/// Commentable lines of one file, keyed by line number in the new file.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FileDiff {
    pub path: String,
    pub lines: BTreeMap<u32, DiffLine>,
    pub additions: usize,
    pub deletions: usize,
}

impl FileDiff {
    /// Parses a patch that starts at the first `@@` hunk header.
    pub fn parse(path: &str, patch: &str) -> Self {
        let mut diff = FileDiff {
            path: path.to_owned(),
            ..Default::default()
        };
        let mut hunk: Option<usize> = None;
        let mut hunk_count = 0usize;
        let mut new_line = 0u32;
        for raw in patch.lines() {
            if raw.starts_with("@@") {
                // Skip the lines of a hunk whose header does not parse.
                hunk = parse_new_start(raw).map(|start| {
                    new_line = start;
                    hunk_count += 1;
                    hunk_count - 1
                });
                continue;
            }
            let Some(hunk) = hunk else { continue };
            let (kind, content) = match raw.as_bytes().first() {
                Some(b'+') => (LineKind::Added, &raw[1..]),
                Some(b' ') => (LineKind::Context, &raw[1..]),
                // GitHub sometimes drops the space on empty context lines.
                None => (LineKind::Context, ""),
                Some(b'-') => {
                    diff.deletions += 1;
                    continue;
                }
                // "\ No newline at end of file" and anything unknown.
                _ => continue,
            };
            if kind == LineKind::Added {
                diff.additions += 1;
            }
            if new_line > 0 {
                diff.lines.insert(
                    new_line,
                    DiffLine {
                        kind,
                        hunk,
                        content: content.to_owned(),
                    },
                );
            }
            new_line += 1;
        }
        diff
    }

    pub fn line(&self, line: u32) -> Option<&DiffLine> {
        self.lines.get(&line)
    }

    /// True when every line in `start..=end` is in the diff and in one hunk.
    pub fn is_range_commentable(&self, start: u32, end: u32) -> bool {
        if start == 0 || start > end {
            return false;
        }
        let Some(first) = self.line(start) else {
            return false;
        };
        (start..=end).all(|n| self.line(n).is_some_and(|l| l.hunk == first.hunk))
    }
}

/// Reads `c` from a header like `@@ -a,b +c,d @@ optional text`.
fn parse_new_start(header: &str) -> Option<u32> {
    let plus = header
        .split_whitespace()
        .find(|part| part.starts_with('+'))?;
    plus[1..].split(',').next()?.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    const PATCH: &str = "@@ -1,3 +1,4 @@\n fn a() {\n-    old();\n+    new();\n+    more();\n }\n@@ -10,2 +11,2 @@ fn b()\n-x\n+y\n z\n\\ No newline at end of file";

    #[test]
    fn maps_new_side_lines() {
        let diff = FileDiff::parse("src/a.rs", PATCH);
        assert_eq!(diff.additions, 3);
        assert_eq!(diff.deletions, 2);
        let numbers: Vec<u32> = diff.lines.keys().copied().collect();
        assert_eq!(numbers, vec![1, 2, 3, 4, 11, 12]);
        assert_eq!(diff.line(2).unwrap().content, "    new();");
        assert_eq!(diff.line(2).unwrap().kind, LineKind::Added);
        assert_eq!(diff.line(4).unwrap().kind, LineKind::Context);
        assert_eq!(diff.line(11).unwrap().hunk, 1);
    }

    #[test]
    fn range_must_stay_in_one_hunk() {
        let diff = FileDiff::parse("src/a.rs", PATCH);
        assert!(diff.is_range_commentable(2, 4));
        assert!(!diff.is_range_commentable(4, 11));
        assert!(!diff.is_range_commentable(5, 5));
        assert!(!diff.is_range_commentable(3, 2));
        assert!(!diff.is_range_commentable(0, 1));
    }

    #[test]
    fn handles_empty_and_garbage_patches() {
        assert!(FileDiff::parse("a", "").lines.is_empty());
        assert!(FileDiff::parse("a", "+no header").lines.is_empty());
        assert!(FileDiff::parse("a", "@@ broken @@\n+x").lines.is_empty());
    }
}

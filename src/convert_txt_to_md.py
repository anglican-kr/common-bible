"""
Convert .txt source files to .md format.

Reads each .txt file in data/source/ and writes a corresponding .md file.
Already-existing .md files (gen.md, ps.md) are skipped.

.txt format:
  - Chapter opener: 책약칭 장:절[part][_alt] [¶] text
  - Subsequent verses: token [¶] text (token = N, N-M, Na, N_M)
  - Blank lines: paragraph/chapter boundaries
  - ¶ or quote continuations: plain text lines

.md format:
  - Chapter header: # N장
  - Verse marker: [N], [N-M], [Na], [N_M]
  - Blank lines preserved
"""

import re
import os
import sys
import glob


CHAPTER_PAT = re.compile(r'([가-힣0-9]+)\s+(\d+):(\d+)')
VERSE_PAT = re.compile(r'^(\d+(?:-\d+)?(?:[a-z])?(?:_\d+)?)\s+(.*)')
# Part suffix after chapter:verse, e.g. "욥기 38:37b text" → remaining="b text"
PART_SUFFIX = re.compile(r'^([a-z])\s+(.*)', re.DOTALL)
# Alt ref suffix, e.g. "에스 1:1_1 text" → remaining="_1 text"
ALT_SUFFIX = re.compile(r'^_(\d+)\s*(.*)', re.DOTALL)


def build_verse_token(verse_num, part=None, alt_ref=None):
    """Build [N], [Na], [N_M] style token."""
    token = str(verse_num)
    if part:
        token += part
    if alt_ref:
        token += f'_{alt_ref}'
    return f'[{token}]'


def convert_file(txt_path, md_path):
    """Convert a single .txt file to .md format."""
    with open(txt_path, 'r', encoding='utf-8') as f:
        lines = f.read().split('\n')

    output = []
    current_book_abbr = None
    current_chapter = None
    first_chapter = True

    i = 0
    while i < len(lines):
        line = lines[i]

        # Check for chapter opener line
        match = CHAPTER_PAT.match(line)
        if match:
            book_abbr = match.group(1)
            chapter_num = int(match.group(2))
            verse_num = int(match.group(3))

            # Determine if this is a new chapter
            is_new = (
                current_chapter is None
                or book_abbr != current_book_abbr
                or (chapter_num != current_chapter and verse_num == 1)
            )

            if is_new:
                if not first_chapter:
                    # Ensure blank line before chapter header
                    # Remove trailing blank lines from output
                    while output and output[-1] == '':
                        output.pop()
                    output.append('')

                output.append(f'# {chapter_num}장')
                output.append('')
                current_book_abbr = book_abbr
                current_chapter = chapter_num
                first_chapter = False

            # Extract remaining text after the chapter:verse match
            remaining = line[len(match.group(0)):].strip()

            # Detect part suffix (e.g., "b text")
            part = None
            m = PART_SUFFIX.match(remaining)
            if m:
                part = m.group(1)
                remaining = m.group(2).strip()

            # Detect alt_ref suffix (e.g., "_1 text")
            alt_ref = None
            m = ALT_SUFFIX.match(remaining)
            if m:
                alt_ref = int(m.group(1))
                remaining = m.group(2).strip()

            if remaining:
                token = build_verse_token(verse_num, part, alt_ref)
                output.append(f'{token} {remaining}')

            i += 1
            continue

        # Check for verse line (starts with digit token)
        stripped = line.strip()
        if stripped:
            m = VERSE_PAT.match(stripped)
            if m:
                token_str = m.group(1)
                text = m.group(2)
                output.append(f'[{token_str}] {text}')
                i += 1
                continue

        # Blank line
        if not stripped:
            output.append('')
            i += 1
            continue

        # Paragraph continuation (¶ line, quote continuation, etc.)
        output.append(stripped)
        i += 1

    # Remove trailing blank lines
    while output and output[-1] == '':
        output.pop()
    output.append('')  # Single trailing newline

    with open(md_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(output))

    return len(output)


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(script_dir)
    source_dir = os.path.join(root, 'data', 'source')

    txt_files = sorted(glob.glob(os.path.join(source_dir, '*.txt')))
    if not txt_files:
        print("변환할 .txt 파일이 없습니다.", file=sys.stderr)
        sys.exit(1)

    converted = 0
    skipped = 0
    for txt_path in txt_files:
        base = os.path.splitext(os.path.basename(txt_path))[0]
        md_path = os.path.join(source_dir, f'{base}.md')

        if os.path.exists(md_path):
            print(f"  건너뜀: {base}.md (이미 존재)")
            skipped += 1
            continue

        line_count = convert_file(txt_path, md_path)
        print(f"  변환: {base}.txt → {base}.md ({line_count}줄)")
        converted += 1

    print(f"\n완료: {converted}개 변환, {skipped}개 건너뜀")


if __name__ == '__main__':
    main()

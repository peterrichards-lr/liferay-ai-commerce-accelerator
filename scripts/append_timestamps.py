import os
import re
from pathlib import Path
from datetime import datetime

IGNORE_DIRS = {'.venv', 'node_modules', '.smoke_venv', '.git', 'build', 'dist', '.agents', 'bundles', 'aica-e2e', 'test-pkg', 'test-project', 'test_tar', 'test-results', 'e2e-logs'}

# Regex to parse the dates from any variant of the footer pattern
FOOTER_REGEX = re.compile(
    r"[\*_]Last Updated:\s*([\d\-]+)[\*_]\s*\|\s*[\*_]Last Reviewed:\s*([\d\-]+)[\*_]",
    re.IGNORECASE
)

# Regex to identify the entire footer block, allowing for optional blank lines (\s*\n\s*) between lines of the block
REMOVE_REGEX = re.compile(
    r"[ \t]*<!-- markdownlint-disable MD049 -->[ \t]*\n\s*---\s*\n\s*[\*_]Last Updated:\s*[\d\-]+[\*_]\s*\|\s*[\*_]Last Reviewed:\s*[\d\-]+[\*_][ \t]*\n?",
    re.IGNORECASE | re.MULTILINE
)

def get_standard_footer(updated_date, reviewed_date):
    return f"\n\n<!-- markdownlint-disable MD049 -->\n\n---\n\n_Last Updated: {updated_date}_ | _Last Reviewed: {reviewed_date}_\n"

def append_timestamps_to_md_files(root_dir):
    today = datetime.now().strftime("%Y-%m-%d")
    root_path = Path(root_dir)
    
    for md_file in root_path.rglob('*.md'):
        if any(ignored in md_file.parts for ignored in IGNORE_DIRS):
            continue
            
        try:
            with open(md_file, 'r', encoding='utf-8') as f:
                content = f.read()
                
            matches = list(FOOTER_REGEX.finditer(content))
            
            if not matches:
                # Case 1: No footer exists. Append fresh one with today's date.
                print(f"Appending new timestamp to {md_file}")
                new_content = content.rstrip() + get_standard_footer(today, today)
            else:
                # Extract dates from existing footers.
                # If there are duplicates, we extract the latest dates.
                updated_dates = []
                reviewed_dates = []
                for match in matches:
                    u, r = match.groups()
                    updated_dates.append(u)
                    reviewed_dates.append(r)
                
                latest_updated = max(updated_dates)
                latest_reviewed = max(reviewed_dates)
                
                # Strip all footer blocks from the content using the removal regex
                cleaned_content = REMOVE_REGEX.sub("", content).rstrip()
                
                standard_footer = get_standard_footer(latest_updated, latest_reviewed)
                expected_content = cleaned_content + standard_footer
                
                if content == expected_content:
                    # Already matching exact format and dates. Skip to preserve git history.
                    continue
                    
                print(f"Fixing/Updating timestamp format in {md_file}")
                new_content = expected_content
                
            with open(md_file, 'w', encoding='utf-8') as f:
                f.write(new_content)
                
        except Exception as e:
            print(f"Failed to process {md_file}: {e}")

if __name__ == "__main__":
    append_timestamps_to_md_files('.')

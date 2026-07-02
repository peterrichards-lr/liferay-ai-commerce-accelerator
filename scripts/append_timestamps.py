import os
import re
from pathlib import Path
from datetime import datetime

IGNORE_DIRS = {'.venv', 'node_modules', '.smoke_venv', '.git', 'build', 'dist', '.agents'}
FOOTER_REGEX = re.compile(r"<!-- markdownlint-disable MD049 -->\n---\n\*Last Updated: [\d\-]+\* \| \*Last Reviewed: [\d\-]+\*")

def append_timestamps_to_md_files(root_dir):
    today = datetime.now().strftime("%Y-%m-%d")
    footer = f"\n\n<!-- markdownlint-disable MD049 -->\n---\n*Last Updated: {today}* | *Last Reviewed: {today}*\n"
    
    root_path = Path(root_dir)
    for md_file in root_path.rglob('*.md'):
        if any(ignored in md_file.parts for ignored in IGNORE_DIRS):
            continue
            
        try:
            with open(md_file, 'r', encoding='utf-8') as f:
                content = f.read()
                
            if not FOOTER_REGEX.search(content):
                print(f"Appending timestamp to {md_file}")
                with open(md_file, 'a', encoding='utf-8') as f:
                    f.write(footer)
        except Exception as e:
            print(f"Failed to process {md_file}: {e}")

if __name__ == "__main__":
    append_timestamps_to_md_files('.')

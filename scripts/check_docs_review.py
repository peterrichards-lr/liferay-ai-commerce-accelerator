import os
import re
import argparse
import sys
from pathlib import Path
from datetime import datetime

IGNORE_DIRS = {'.venv', 'node_modules', '.smoke_venv', '.git', 'build', 'dist', '.agents', 'bundles', 'aica-e2e', 'test-pkg', 'test-project', 'test_tar'}
FOOTER_REGEX = re.compile(r"\*Last Updated: ([\d\-]+)\* \| \*Last Reviewed: ([\d\-]+)\*")

def check_docs_review(root_dir, max_review_days, max_update_days, max_gap_days):
    today = datetime.now()
    failed_files = []
    
    root_path = Path(root_dir)
    for md_file in root_path.rglob('*.md'):
        if any(ignored in md_file.parts for ignored in IGNORE_DIRS):
            continue
            
        try:
            with open(md_file, 'r', encoding='utf-8') as f:
                content = f.read()
                
            match = FOOTER_REGEX.search(content)
            if not match:
                failed_files.append((md_file, "No timestamp footer found"))
                continue
                
            updated_str, reviewed_str = match.groups()
            updated_date = datetime.strptime(updated_str, "%Y-%m-%d")
            reviewed_date = datetime.strptime(reviewed_str, "%Y-%m-%d")
            
            review_age = (today - reviewed_date).days
            update_age = (today - updated_date).days
            gap = (reviewed_date - updated_date).days
            
            issues = []
            if max_review_days is not None and review_age > max_review_days:
                issues.append(f"Review age ({review_age} days) exceeds max ({max_review_days} days)")
            if max_update_days is not None and update_age > max_update_days:
                issues.append(f"Update age ({update_age} days) exceeds max ({max_update_days} days)")
            if max_gap_days is not None and gap > max_gap_days:
                issues.append(f"Gap between update and review ({gap} days) exceeds max ({max_gap_days} days)")
                
            if issues:
                failed_files.append((md_file, "; ".join(issues)))
                
        except Exception as e:
            failed_files.append((md_file, f"Error processing file: {e}"))

    if failed_files:
        print("Documentation review checks failed for the following files:")
        for file, reason in failed_files:
            print(f"  - {file}: {reason}")
        sys.exit(1)
    else:
        print("All documentation review checks passed.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Check documentation review timestamps")
    parser.add_argument('--max-review-days', type=int, help='Maximum allowed days since last review')
    parser.add_argument('--max-update-days', type=int, help='Maximum allowed days since last update')
    parser.add_argument('--max-gap-days', type=int, help='Maximum allowed days between update and review')
    parser.add_argument('--dir', type=str, default='.', help='Directory to scan')
    
    args = parser.parse_args()
    check_docs_review(args.dir, args.max_review_days, args.max_update_days, args.max_gap_days)

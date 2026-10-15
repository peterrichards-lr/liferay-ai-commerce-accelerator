import os
import re
import subprocess
import argparse
import sys
from pathlib import Path
from datetime import datetime

IGNORE_DIRS = {
    '.venv',
    'node_modules',
    '.smoke_venv',
    '.git',
    'build',
    'dist',
    '.agents',
    'bundles',
    'aica-e2e',
    'test-pkg',
    'test-project',
    'test_tar',
    'test-results',
    'e2e-logs',
    'playwright-report',
    'prompts',
}
# `Last Updated` is optional, and absent on every page published to the docs
# site: mkdocs-git-revision-date-localized generates that date from git, which
# cannot drift from the file the way a hand-typed one does. `Last Reviewed` is
# required everywhere, because no commit timestamp can express it - a one-word
# correction is a change, not a review, and only a person or an agent reading
# the page can say the second thing happened.
#
# Files that are not published (AGENTS.md, CONTRIBUTING.md, conductor/**) keep
# both dates, since nothing generates the first for them. Both forms pass. See
# the docs About page, which commits to this publicly, and #1297.
FOOTER_REGEX = re.compile(
    r"(?:[\*_]Last Updated: ([\d\-]+)[\*_] \| )?"
    r"[\*_]Last Reviewed: ([\d\-]+)[\*_]"
)

def _markdown_files(root_path):
    """Every markdown file the check applies to.

    Tracked files only, when this runs inside a git work tree. The directory
    walk it replaces also found untracked and ignored files - local scratch
    like `.agent-state.md`, and anything under a gitignored directory - so the
    check failed on a developer's machine and passed in CI, where those files
    do not exist. A guard that only holds on one of the two machines it runs on
    is not a guard.

    Falls back to the walk outside a repository, so `--dir` still works when
    pointed at an extracted package or a copied tree.
    """
    try:
        listing = subprocess.run(
            ['git', '-C', str(root_path), 'ls-files', '-z', '--', '*.md'],
            capture_output=True,
            check=True,
        )
    except (OSError, subprocess.CalledProcessError):
        yield from root_path.rglob('*.md')
        return

    for name in listing.stdout.decode('utf-8').split('\0'):
        if name:
            yield root_path / name


def check_docs_review(root_dir, max_review_days, max_update_days, max_gap_days):
    today = datetime.now()
    failed_files = []
    skipped_update_checks = []
    
    root_path = Path(root_dir)
    for md_file in _markdown_files(root_path):
        if any(ignored in md_file.parts for ignored in IGNORE_DIRS):
            continue
        if any(part.startswith('aica-e2e') for part in md_file.parts):
            continue
            
        try:
            with open(md_file, 'r', encoding='utf-8') as f:
                content = f.read()
                
            match = FOOTER_REGEX.search(content)
            if not match:
                failed_files.append((md_file, "No timestamp footer found"))
                continue
                
            updated_str, reviewed_str = match.groups()
            reviewed_date = datetime.strptime(reviewed_str, "%Y-%m-%d")
            review_age = (today - reviewed_date).days

            issues = []
            if max_review_days is not None and review_age > max_review_days:
                issues.append(f"Review age ({review_age} days) exceeds max ({max_review_days} days)")

            # The update checks apply only where a manual update date exists.
            # Silently passing a page that has none would make --max-update-days
            # report success for every published document, which is the failure
            # mode this repository keeps finding: a check that cannot see its
            # own subject and whose silence reads as a pass.
            if updated_str is None:
                if max_update_days is not None or max_gap_days is not None:
                    skipped_update_checks.append(md_file)
            else:
                updated_date = datetime.strptime(updated_str, "%Y-%m-%d")
                update_age = (today - updated_date).days
                gap = (reviewed_date - updated_date).days
                if max_update_days is not None and update_age > max_update_days:
                    issues.append(f"Update age ({update_age} days) exceeds max ({max_update_days} days)")
                if max_gap_days is not None and gap > max_gap_days:
                    issues.append(f"Gap between update and review ({gap} days) exceeds max ({max_gap_days} days)")
                
            if issues:
                failed_files.append((md_file, "; ".join(issues)))
                
        except Exception as e:
            failed_files.append((md_file, f"Error processing file: {e}"))

    if skipped_update_checks:
        print(
            f"Note: {len(skipped_update_checks)} published file(s) carry no manual "
            "'Last Updated' date, so --max-update-days and --max-gap-days did not "
            "apply to them. The site generates that date from git history."
        )

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

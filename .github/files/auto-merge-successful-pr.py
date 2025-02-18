#!/bin/env python3

import os
import shlex
import subprocess
import json

from dataclasses import dataclass
from functools import reduce
from typing import Generator

APPROVE_MSG = os.environ.get("APPROVE_MSG", "All status checks passed for PR #{}.")
BOT_AUTHORS = [a for a in os.environ.get("BOT_AUTHORS", "").split(",") if a]
DRY_RUN = os.environ.get("DRY_RUN", "true") == "true"
LABELS = [l for l in os.environ.get("LABELS", "automerge").split(",") if l]
MIN_PASSING_CHECKS = int(os.environ.get("MIN_PASSING_CHECKS", "1"))


@dataclass
class PullRequestCheck:
    name: str
    bucket: str


@dataclass
class PullRequestChecks:
    passed: list[PullRequestCheck]
    failed: list[PullRequestCheck]
    pending: list[PullRequestCheck]
    skipping: list[PullRequestCheck]
    cancel: list[PullRequestCheck]

    @classmethod
    def from_list(cls, checks: list[dict]):
        passed, failed, pending, skipping, cancel = [], [], [], [], []
        for check_obj in checks:
            check = PullRequestCheck(**check_obj)
            if check.bucket == "pass":
                passed.append(check_obj)
            elif check.bucket == "fail":
                failed.append(check_obj)
            elif check.bucket == "pending":
                pending.append(check_obj)
            elif check.bucket == "skipping":
                skipping.append(check_obj)
            elif check.bucket == "cancel":
                cancel.append(check_obj)
        return cls(passed, failed, pending, skipping, cancel)


@dataclass
class PullRequestAuthor:
    is_bot: bool
    login: str
    id: str | None = None
    name: str | None = None


@dataclass
class PullRequest:
    number: int
    author: PullRequestAuthor
    title: str
    labels: list[str]
    mergeable: str
    baseRefName: str
    checks: PullRequestChecks | None = None


def tab(text: str) -> str:
    """Indent the given text by the given number of spaces."""
    return f"   └── {text}"


def sh(cmd: str, dry_run=False) -> str:
    """Run a shell command and return its output."""
    if dry_run:
        print(tab(f"Would run: {cmd}"))
        return ""
    _pipe = subprocess.PIPE
    result = subprocess.run(shlex.split(cmd), stdout=_pipe, stderr=_pipe, text=True)
    if result.returncode != 0:
        raise Exception(f"Error running command: {cmd}\nError: {result.stderr}")
    return result.stdout.strip()


def get_pull_requests() -> Generator[PullRequest, None, None]:
    """Fetch open pull requests matching some label."""
    prs_json = sh("gh pr list --state open --json number,labels,title")
    prs = sorted(json.loads(prs_json), key=lambda pr: pr["number"])
    for pr_dict in prs:
        view_json = sh(
            f"gh pr view {pr_dict['number']} --json mergeable,baseRefName,author"
        )
        view = json.loads(view_json)
        view["author"] = PullRequestAuthor(**view["author"])
        pr_dict.update(view)
        pr = PullRequest(**pr_dict)
        print("PR #{:<5} - '{}' by {}".format(pr.number, pr.title, pr.author.login))
        yield pr


def match_labels_or_bot(prs) -> Generator[PullRequest, None, None]:
    """Filter PRs that have all the required labels."""
    print(f"{LABELS=}")
    for pr in prs:
        if pr.author.is_bot and pr.author.login in BOT_AUTHORS:
            print(tab("is bot author"))
            yield pr
            continue
        pr_labels = [l["name"] for l in pr.labels]
        missing = [req for req in LABELS if not req in pr_labels]
        if not LABELS or not missing:
            print(tab("matches labels"))
            yield pr
        else:
            print(tab(f"skipped not labeled with labels={','.join(missing)}"))


def mergeable_prs(prs) -> Generator[PullRequest, None, None]:
    """Filter PRs that are mergeable."""
    for pr in prs:
        if pr.mergeable == "MERGEABLE":
            print(tab("is mergeable"))
            yield pr
        else:
            print(tab("not mergeable"))


def check_prs_ready(prs) -> Generator[PullRequest, None, None]:
    """Filter PRs that have passed the required checks."""
    for pr in prs:
        checks_json = sh(f"gh pr checks {pr.number} --json bucket,name")
        checks = json.loads(checks_json)
        pr.checks = PullRequestChecks.from_list(checks)

        checks_passed = len(pr.checks.passed)
        any_unready = (
            len(pr.checks.failed) or len(pr.checks.pending) or len(pr.checks.cancel)
        )
        if any_unready:
            print(tab(f"skipped tests are not passing"))
            continue
        if checks_passed < MIN_PASSING_CHECKS:
            print(tab(f"skipped passing but with too few checks ({checks_passed})"))
            continue
        yield pr


def approve_and_merge_pr(pr, merged) -> None:
    """Approve and merge the PR."""
    print(tab("is ready to merging"))
    sh(
        f'gh pr review {pr.number} --comment -b "{APPROVE_MSG.format(pr.number)}"',
        DRY_RUN,
    )
    sh(f"gh pr merge {pr.number} --admin --squash", DRY_RUN)
    if not DRY_RUN:
        print(tab(f"merged to {pr.baseRefName}"))
    merged[pr.baseRefName] = pr


def rebase_pr(pr) -> None:
    """Rebase the PR."""
    print(tab(f"needs to be rebased from {pr.baseRefName}"))
    sh(f"gh pr update-branch {pr.number} --rebase", DRY_RUN)


def process_pull_requests():
    """Process the PRs and merge if checks have passed."""
    prs = get_pull_requests()
    labelled = match_labels_or_bot(prs)
    checkable = mergeable_prs(labelled)
    ready = check_prs_ready(checkable)

    merged = {}

    for pr in ready:
        if pr.baseRefName not in merged:
            approve_and_merge_pr(pr, merged)
        else:
            rebase_pr(pr)


if __name__ == "__main__":
    process_pull_requests()

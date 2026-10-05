---
title: 'Output Language Rules'
description: 'Which language to use for replies, PRs, commits, code and comments.'
category: 'rules'
type: 'specification'
status: 'active'
date: 2026-10-05
updated: 2026-10-05
lang: 'en'
tags:
  - 'rules'
  - 'language'
alwaysApply: true
---

# Output Language Rules (`language-rules-output`)

| Artifact                                                              | Language                                                                                              |
| :-------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------- |
| Replies to the user in chat                                           | Japanese                                                                                              |
| Pull request titles                                                   | English Conventional Commits prefix (`feat(scope):`), description after the colon in Japanese         |
| Pull request descriptions (filled `.github/PULL_REQUEST_TEMPLATE.md`) | Japanese; keep technical terms, identifiers and error messages in English                             |
| Commit messages                                                       | English (Conventional Commits, see [`git-rules-commit.md`](git-rules-commit.md))                      |
| Code, identifiers, code comments                                      | English                                                                                               |
| Change artifacts (`.devs/changes/`)                                   | Follow the existing language of the change directory (English by default)                             |
| Documentation                                                         | Follow the existing language of each file; bilingual docs keep `README.md` and `README.ja.md` in sync |

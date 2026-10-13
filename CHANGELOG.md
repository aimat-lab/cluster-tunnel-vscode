# Changelog

All notable changes to the ctun VS Code extension. The format follows
[Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- Clusters view from `ctun status -j`: status, session start, budget used / limit,
  commands sent, running and queued jobs; log in (ctun's login window) and log out.
- "Cluster jobs" tab from `ctun jobs --json`: one list filtered by state toggles,
  an "Ended in" window and cluster chips; refreshes every 60 s while visible.
- Status-bar entry with the connected clusters and their budget use.

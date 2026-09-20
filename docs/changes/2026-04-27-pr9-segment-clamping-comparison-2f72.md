---
date: 2026-04-27
pr: 9
branch: cursor/segment-clamping-comparison-2f72
title: "Segment clamping comparison"
---

# Segment clamping comparison

Compare serialized highlight segment specs to robustly detect URL rewrite needs, fixing a fragile comparison that missed changes to segment parts.

The original `needsRewrite` check compared `clamped` and `hlSegments` by index, only checking the `end` field. This was problematic because it didn't account for changes in other segment fields (like `part`) and was fragile to future changes in filtering/mapping logic, potentially leading to stale URLs. Comparing the full serialized spec strings ensures all relevant segment properties are considered for the rewrite decision.

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Low risk, localized change to client-side URL normalization logic for highlighted verse segments. Main risk is minor URL rewrite behavior changes for edge-case highlight specs (e.g., parts/ranges).
> 
> **Overview**
> Tightens URL normalization for multi-segment verse highlights by generating a canonical serialized spec for `clamped` segments and using it to decide whether `history.replaceState` should rewrite the path.
> 
> This replaces the prior `needsRewrite` heuristic (length + `end`-only, index-based comparison) so changes to other segment properties (notably `part`) and future mapping/filtering differences don’t leave stale highlight specs in the URL.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 844827aaa37a155ff3a7fb1a0517ba327f823900. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->

# Project Status Report

## CodeBuilders — Desktop Screen Recording & Live Streaming Studio

| | |
|---|---|
| **Report date** | 17 August 2026 |
| **Build version** | 0.4.0 |
| **Current phase** | Phase 2 — Hardening & Commercial Readiness |
| **Prepared for** | Client review |

---

## 1. Summary

The application is functionally complete and running. Phase 2 work is underway
and is where the project now sits: the platform migration is done, the
automated test suite is in place, and the installer builds.

What the product is not yet is something that can be put in front of paying
customers. That gap is mostly not engineering work. Three of the four
outstanding items need decisions or purchases from your side, and one of them
has a lead time nobody can compress.

**The single most time-sensitive action is procuring a Windows code signing
certificate.** Everything in Phase 3 waits on it, and verification can take
several weeks.

---

## 2. Phase 1 — Core application

**Complete.**

The application supports:

- Scene and source composition, with live preview and studio mode
- Recording to local storage, including separate audio tracks per device
- Live streaming to any RTMP service
- Replay buffer, virtual camera output, and still screenshots
- Multi-channel audio mixing with per-channel noise suppression
- Scene filters: colour correction, crop, chroma key, blur, sharpen
- Multiview, scene transitions, and configurable global hotkeys
- Scene collections and configuration profiles, with import and export
- A JavaScript plugin system
- Automatic update delivery (built; not yet active — see 4.2)

---

## 3. Phase 2 — Progress since the last update

### 3.1 Platform migration — complete

The application has moved from Rust to Electron, as agreed. The purpose was
maintainability: the product is now a single TypeScript codebase that your
team can staff and maintain without specialist Rust experience.

The user interface transferred without modification. All backend functionality
was rebuilt and verified, including a test recording confirmed as a valid
1920×1080 H.264 file.

The cost, as discussed before the decision, is size. The installer is 112 MB
against 6 MB previously, because Electron ships its own browser engine. For
context, this is normal for the category — OBS Studio is of comparable size,
and Streamlabs Desktop is built on the same technology.

### 3.2 Automated testing — established, partially complete

The project previously had no automated tests. It now has **189**, running in
under three seconds.

Coverage of the backend — the layer that handles recording, streaming, and all
data storage — now meets the 70% target set in the requirements specification.
Interface-level coverage is still low and is the main remaining test work.

This was not a formality. The work found and fixed four defects that were
already present:

| Defect | Consequence |
|---|---|
| Database deletions not cascading | Deleting a scene collection left hidden data behind indefinitely. Seven stranded records were found on a single development machine. |
| Streaming status never reaching the interface | The Stop button would never appear during a live stream, and the timer would never run. |
| Filename collisions | Two recordings or screenshots created within the same second silently overwrote one another. |
| Four non-functional controls | Fullscreen preview, screenshot, open recordings folder, and multiview were all clickable but did nothing. |

All four are fixed and covered by tests. The first three would have been very
difficult to diagnose from user reports, since none of them produce an error
message — they lose data or do nothing.

### 3.3 Packaging — working

Both NSIS and MSI installers build, and the packaged application has been
verified running. Every release is archived so earlier versions remain
available.

### 3.4 Outstanding in Phase 2

| Item | Owner | Status |
|---|---|---|
| Interface and component tests | Development | In progress |
| Crash reporting | Development | Not started |
| Code signing | **Client** | Blocked — certificate not yet procured |
| Legal review (see 4.1) | **Client** | Blocked — not yet started |
| Branding and product identity | **Client** | Blocked — details not yet provided |

---

## 4. Decisions and actions required

### 4.1 Legal review — blocks release

Two questions need your legal counsel. Neither is an engineering decision and
we cannot resolve them.

**FFmpeg licensing.** The application depends on FFmpeg for all video
encoding. The standard distributions are GPL-licensed, and including one inside
commercial closed-source software would oblige you to publish your own source
code. The alternatives are to commission a differently-licensed build, or to
keep the current arrangement where the user installs FFmpeg separately. The
second is free but adds a step to installation.

**Codec patents.** H.264 and AAC may carry separate patent licensing for
commercial distribution, independent of FFmpeg's own licence.

We also need an end-user licence agreement and a privacy policy before release.

### 4.2 Code signing certificate — blocks release, longest lead time

Without a certificate, every user who downloads the installer is shown a
full-screen Windows warning that the application is unrecognised and possibly
unsafe. In practice most people stop at that screen.

The certificate must be issued to your company, which means the verification
process runs at your registrar's pace — typically several days, sometimes
several weeks. Cost is approximately USD 200–600 per year.

This also unblocks automatic updates, which are built but cannot be activated
until releases can be signed.

### 4.3 Product identity — needed before first release

We need the final product name, company name, and application identifier.

This matters more than it sounds. The identifier determines where the
application stores user settings. Changing it after release relocates that
folder, and every existing user loses their scenes and configuration. It has to
be correct before the first public installer ships.

### 4.4 Two questions that determine Phase 3 scope

**Which platforms?** The application currently runs on Windows only. macOS and
Linux are achievable but require rebuilding the screen capture layer, and macOS
additionally needs an Apple developer account and Apple's notarisation process.
If cross-platform support was assumed, we should scope it as separate work.

**Free or paid?** There is currently no licensing, activation, trial, or
payment capability in the product. If you intend to sell it, that is a
substantial feature set that has not been built or estimated. We raise it
explicitly because it is commonly assumed to be included.

---

## 5. Phase 3 — Launch and distribution

Not started, and not yet scoped. It cannot begin until the code signing
certificate is in hand.

Candidate work, subject to your answers in section 4.4:

- Public release and update distribution
- Licence enforcement and payment, if the product is to be sold
- macOS and Linux support
- Localisation

---

## 6. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Certificate procurement delays release | High — nothing in Phase 3 can start | Begin the application immediately; it is the longest lead item |
| FFmpeg licensing decided late, or unfavourably | High — may change how the product is installed, or oblige source disclosure | Route to legal counsel now; both outcomes are workable if known early |
| Identifier changed after release | High — every existing user loses their settings | Confirm product identity before the first public installer |
| Cross-platform or payment assumed to be included | Medium — significant unbudgeted work | Confirm scope in section 4.4 |
| Interface test coverage still low | Medium — defects may reach users | Continuing as the current development priority |

---

## 7. Recommended next steps

**This week, on your side:**

1. Begin the code signing certificate application
2. Send the FFmpeg and codec licensing questions to your legal counsel
3. Confirm the product name, company name, and application identifier
4. Answer the platform and commercial-model questions in section 4.4

**On ours:**

5. Continue interface and component testing
6. Add crash reporting
7. Prepare the signing and release pipeline so it is ready the day the
   certificate arrives

Items 1 to 3 are the critical path. Engineering work continues regardless, but
the release date is governed by the certificate rather than by development.

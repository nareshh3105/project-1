# Software Requirements Specification

## CodeBuilders — Desktop Screen Recording & Live Streaming Studio

| | |
|---|---|
| **Document version** | 1.0 |
| **Date** | 9 August 2026 |
| **Product version** | 0.4.0 (pre-release) |
| **Status** | Draft for client review |
| **Prepared by** | Development Team |

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [General Description](#2-general-description)
3. [Functional Requirements](#3-functional-requirements)
4. [Interface Requirements](#4-interface-requirements)
5. [Performance Requirements](#5-performance-requirements)
6. [Design Constraints](#6-design-constraints)
7. [Non-Functional Attributes](#7-non-functional-attributes)
8. [Preliminary Schedule and Budget](#8-preliminary-schedule-and-budget)
9. [Appendices](#9-appendices)

---

# 1. Introduction

## 1.1 Purpose

This document specifies the software requirements for **CodeBuilders**, a desktop application for screen recording, live streaming, and multi-scene video production.

It is intended for the client's technical and commercial stakeholders, the development and QA teams, and any third party contracted to extend or maintain the product. It defines what the system must do, the constraints under which it must operate, and the criteria by which completion is judged.

## 1.2 Scope

CodeBuilders is a standalone desktop application. It captures video from displays, windows, and cameras; mixes multiple audio sources; composes them into named scenes; and records the result to disk or transmits it to a live streaming service.

**In scope for the current release (v1.0):**

- Scene and source composition with live preview
- Recording to local storage, including multi-track audio
- Live streaming over RTMP
- Replay buffer, virtual camera output, and still screenshots
- Multi-channel audio mixing with per-channel noise suppression
- Scene filters, transitions, and studio mode
- Configuration profiles, scene collections, and global hotkeys
- A JavaScript plugin system
- Automatic update delivery
- Microsoft Windows 10 and 11, 64-bit

**Explicitly out of scope for v1.0:**

- macOS and Linux support
- Licence enforcement, activation, or in-application payment
- Cloud storage, cloud rendering, or account services
- Video editing beyond live composition
- Mobile or web clients

Out-of-scope items are candidates for later releases and are not covered by this specification.

## 1.3 Definitions, Acronyms and Abbreviations

| Term | Meaning |
|---|---|
| **Scene** | A named arrangement of sources composited into a single video output |
| **Source** | A single input within a scene — a display, window, camera, image, or text |
| **Scene Collection** | A named group of scenes, switchable as a unit |
| **Profile** | A saved set of application settings, independent of scenes |
| **Program** | The scene currently being recorded or streamed |
| **Preview** | In Studio Mode, the scene being staged before it goes to Program |
| **Replay Buffer** | A rolling in-memory recording of recent activity, saved on demand |
| **Virtual Camera** | The composed output exposed as a video source for other applications |
| **FFmpeg** | Third-party multimedia framework used for encoding and muxing |
| **RTMP** | Real-Time Messaging Protocol, used to transmit to streaming platforms |
| **IPC** | Inter-Process Communication, between the interface and backend processes |
| **NS** | Noise Suppression |
| **SRS** | Software Requirements Specification (this document) |

## 1.4 References

| Ref | Document |
|---|---|
| R1 | IEEE 830-1998, Recommended Practice for Software Requirements Specifications |
| R2 | Electron documentation — https://electronjs.org/docs |
| R3 | FFmpeg documentation and licensing — https://ffmpeg.org |
| R4 | Microsoft Authenticode code signing requirements |
| R5 | RTMP Specification 1.0, Adobe Systems |

## 1.5 Overview

Section 2 describes the product in general terms and the environment it operates within. Section 3 specifies functional requirements, each carrying a unique identifier for traceability. Sections 4 to 7 cover interfaces, performance, design constraints, and non-functional attributes. Section 8 provides a preliminary schedule and budget. Section 9 contains supporting appendices, including a requirement-to-release map.

---

# 2. General Description

## 2.1 Product Perspective

CodeBuilders is a new, self-contained product. It does not replace or extend an existing system, and it does not depend on any server component operated by the client, with the single exception of the update distribution endpoint described in FR-16.

It operates in a market alongside established tools such as OBS Studio and Streamlabs Desktop. Its intended differentiation is a modernised interface and a simplified configuration model.

The application is structured as two cooperating processes:

```
┌──────────────────────────┐         ┌──────────────────────────┐
│   Interface Process      │◄──IPC──►│   Backend Process        │
│                          │         │                          │
│   Scene composition UI   │         │   Media encoding         │
│   Live preview           │         │   Database persistence   │
│   Audio meters           │         │   System integration     │
└──────────────────────────┘         └──────────────────────────┘
                                                  │
                                                  ▼
                                     ┌──────────────────────────┐
                                     │  FFmpeg   SQLite   OS    │
                                     └──────────────────────────┘
```

Video capture is performed in the interface process using standard media capture APIs. Encoding, muxing, and transmission are delegated to FFmpeg, which the backend process invokes as a child process.

## 2.2 Product Functions

At a high level, the product allows a user to:

1. Compose scenes from multiple video and audio sources
2. Preview output live, and stage changes before broadcasting them
3. Record output to local storage in a choice of container formats
4. Stream output to any RTMP-compatible service
5. Maintain a rolling replay buffer and save recent activity on demand
6. Expose the composed output as a virtual camera to other applications
7. Capture still screenshots
8. Mix and process multiple independent audio channels
9. Apply visual filters to individual sources
10. Organise work into scene collections and configuration profiles
11. Trigger common operations by global keyboard shortcut
12. Extend functionality through JavaScript plugins
13. Receive and install application updates automatically

## 2.3 User Characteristics

| Class | Description | Technical level | Expected frequency |
|---|---|---|---|
| **Content creator** | Streams or records for an audience | Low to moderate | Daily |
| **Educator / trainer** | Records lectures and demonstrations | Low | Weekly |
| **Corporate user** | Records meetings, produces internal video | Low | Occasional |
| **Power user** | Complex multi-scene productions, plugin authoring | High | Daily |

The interface must be operable by the low-technical-level classes without documentation for basic recording. Advanced capability may be placed behind secondary interfaces provided it does not obstruct simple use.

## 2.4 General Constraints

| ID | Constraint |
|---|---|
| GC-1 | The product shall run on Microsoft Windows 10 and 11, 64-bit |
| GC-2 | The product depends on FFmpeg for all encoding, muxing, and transmission |
| GC-3 | Bundling of FFmpeg is subject to unresolved licensing review (see 6.4) |
| GC-4 | Installers must be signed with an Authenticode certificate issued to the client |
| GC-5 | The product shall not require a user account or network connectivity, except for streaming and updates |
| GC-6 | All user data shall be stored locally; no user content is transmitted to the vendor |

## 2.5 Assumptions and Dependencies

| ID | Assumption or dependency |
|---|---|
| AD-1 | An FFmpeg binary is available on the host, either bundled or user-installed and reachable on `PATH` |
| AD-2 | The host provides at least one display and one audio output device |
| AD-3 | The client will procure an Authenticode code signing certificate in their company name |
| AD-4 | The client will provide final branding, including product name and bundle identifier, before first public release |
| AD-5 | The client will obtain legal clearance on FFmpeg licensing and codec patents |
| AD-6 | Update distribution will use a publicly reachable HTTPS endpoint under the client's control |

A failure of AD-1, AD-3, or AD-5 blocks public release.

---

# 3. Functional Requirements

Requirements are grouped by module. Each carries a unique identifier and a priority:

- **M** — Mandatory. The release is not acceptable without it.
- **D** — Desirable. Expected, but may be deferred by agreement.
- **O** — Optional. Included if schedule allows.

## 3.1 Scene Management

| ID | Requirement | Priority |
|---|---|---|
| FR-1.1 | The system shall allow the user to create a named scene | M |
| FR-1.2 | The system shall allow the user to rename an existing scene | M |
| FR-1.3 | The system shall allow the user to delete a scene, provided at least one scene remains | M |
| FR-1.4 | The system shall allow the user to duplicate a scene, including all its sources and their settings | M |
| FR-1.5 | The system shall allow the user to reorder scenes, and shall persist that order | M |
| FR-1.6 | The system shall designate exactly one scene as the Program scene at any time | M |
| FR-1.7 | The system shall persist all scenes to local storage and restore them on next launch | M |
| FR-1.8 | On first launch, the system shall create a default scene collection containing one empty scene | M |

## 3.2 Source Management

| ID | Requirement | Priority |
|---|---|---|
| FR-2.1 | The system shall allow the user to add a source to the active scene | M |
| FR-2.2 | The system shall support the following source types: Display Capture, Window Capture, Camera, Image, Text | M |
| FR-2.3 | The system shall allow the user to rename a source | M |
| FR-2.4 | The system shall allow the user to remove a source from a scene | M |
| FR-2.5 | The system shall allow the user to toggle a source's visibility without removing it | M |
| FR-2.6 | The system shall allow the user to lock a source, preventing further modification until unlocked | D |
| FR-2.7 | The system shall allow the user to reorder sources within a scene, determining composite layer order | M |
| FR-2.8 | The system shall render the topmost visible capture source in the preview | M |
| FR-2.9 | The system shall persist all source settings and restore them on next launch | M |
| FR-2.10 | The system shall delete a scene's sources when that scene is deleted | M |

## 3.3 Preview and Studio Mode

| ID | Requirement | Priority |
|---|---|---|
| FR-3.1 | The system shall display a live preview of the Program scene | M |
| FR-3.2 | The system shall provide a Studio Mode presenting Preview and Program side by side | D |
| FR-3.3 | In Studio Mode, the system shall allow the user to stage a scene to Preview without affecting Program | D |
| FR-3.4 | In Studio Mode, the system shall provide a Transition control promoting Preview to Program | D |
| FR-3.5 | The system shall support the following transitions: Cut, Fade, Slide, Wipe | D |
| FR-3.6 | The system shall allow the user to configure transition duration in milliseconds | D |
| FR-3.7 | The system shall provide a borderless fullscreen preview of the Program scene, exited by the Escape key | D |
| FR-3.8 | The system shall provide a Multiview showing all scenes in a grid, indicating Program and Preview scenes, and allowing scene selection by click | D |

## 3.4 Audio Mixing

| ID | Requirement | Priority |
|---|---|---|
| FR-4.1 | The system shall provide independent channels for Desktop, Microphone, Browser, and Music audio | M |
| FR-4.2 | The system shall display a real-time stereo level meter per channel | M |
| FR-4.3 | The system shall display peak level in decibels per channel, with peak hold | D |
| FR-4.4 | The system shall allow independent volume adjustment per channel | M |
| FR-4.5 | The system shall allow independent muting per channel | M |
| FR-4.6 | The system shall allow noise suppression to be enabled per channel | D |
| FR-4.7 | The system shall colour meter segments to indicate safe, caution, and clipping levels | D |
| FR-4.8 | The system shall enumerate audio input devices available on the host | M |

## 3.5 Recording

| ID | Requirement | Priority |
|---|---|---|
| FR-5.1 | The system shall record the Program scene to a local file | M |
| FR-5.2 | The system shall support MKV and MP4 output containers | M |
| FR-5.3 | The system shall allow the user to select which audio devices are recorded | D |
| FR-5.4 | The system shall record each selected audio device as a separate track | D |
| FR-5.5 | The system shall apply noise suppression to a track when enabled for that channel | D |
| FR-5.6 | The system shall write recordings to a user-configurable directory, defaulting to the user's Videos folder | M |
| FR-5.7 | The system shall name recordings with a timestamp to prevent collision | M |
| FR-5.8 | The system shall display elapsed recording duration | M |
| FR-5.9 | The system shall prevent a second recording from starting while one is active | M |
| FR-5.10 | The system shall report a clear, actionable error if recording cannot start | M |

## 3.6 Streaming

| ID | Requirement | Priority |
|---|---|---|
| FR-6.1 | The system shall stream the Program scene to an RTMP endpoint | M |
| FR-6.2 | The system shall allow the user to configure the RTMP server URL and stream key | M |
| FR-6.3 | The system shall mask the stream key by default, with an option to reveal it | M |
| FR-6.4 | The system shall store the stream key locally and never transmit it other than to the configured endpoint | M |
| FR-6.5 | The system shall display live streaming status and elapsed duration | M |
| FR-6.6 | The system shall report a clear error if the stream fails to start or is dropped | M |
| FR-6.7 | The system shall permit simultaneous recording and streaming | D |

## 3.7 Replay Buffer

| ID | Requirement | Priority |
|---|---|---|
| FR-7.1 | The system shall maintain a rolling buffer of recent output when enabled | D |
| FR-7.2 | The system shall allow the buffer duration to be configured | D |
| FR-7.3 | The system shall save the buffer contents to a file on user request | D |
| FR-7.4 | The system shall confirm the saved file location to the user | D |
| FR-7.5 | The system shall discard buffer data on stop without writing it to permanent storage | D |

## 3.8 Virtual Camera

| ID | Requirement | Priority |
|---|---|---|
| FR-8.1 | The system shall expose the Program scene as a video stream consumable by other applications | D |
| FR-8.2 | The system shall display the consumption endpoint to the user while active | D |
| FR-8.3 | The system shall release the endpoint cleanly on stop | D |

## 3.9 Screenshots

| ID | Requirement | Priority |
|---|---|---|
| FR-9.1 | The system shall capture a still image of the display on user request | D |
| FR-9.2 | The system shall save screenshots as PNG to a configurable directory, defaulting to the user's Pictures folder | D |
| FR-9.3 | The system shall confirm the saved filename to the user | D |

## 3.10 Scene Filters

| ID | Requirement | Priority |
|---|---|---|
| FR-10.1 | The system shall allow filters to be applied to an individual source | D |
| FR-10.2 | The system shall support: Colour Correction, Crop/Pad, Chroma Key, Gaussian Blur, Sharpen | D |
| FR-10.3 | The system shall allow multiple filters on one source, applied in a user-defined order | D |
| FR-10.4 | The system shall allow a filter to be disabled without removing it | D |
| FR-10.5 | The system shall persist filter configuration and restore it on next launch | D |

## 3.11 Scene Collections

| ID | Requirement | Priority |
|---|---|---|
| FR-11.1 | The system shall allow the user to create, rename, duplicate, and delete scene collections | D |
| FR-11.2 | The system shall allow switching between collections, replacing the active scene set | D |
| FR-11.3 | The system shall export a collection to a portable file | D |
| FR-11.4 | The system shall import a previously exported collection | D |
| FR-11.5 | The system shall prevent deletion of the last remaining collection | M |
| FR-11.6 | The system shall restore the previously active collection on next launch | D |

## 3.12 Profiles

| ID | Requirement | Priority |
|---|---|---|
| FR-12.1 | The system shall allow the user to create, rename, duplicate, and delete configuration profiles | D |
| FR-12.2 | The system shall apply all stored settings when a profile is activated | D |
| FR-12.3 | The system shall prevent deletion of the last remaining profile | M |
| FR-12.4 | The system shall restore the previously active profile on next launch | D |

## 3.13 Hotkeys

| ID | Requirement | Priority |
|---|---|---|
| FR-13.1 | The system shall allow global keyboard shortcuts to be assigned to application actions | D |
| FR-13.2 | Hotkeys shall be effective when the application does not have focus | D |
| FR-13.3 | The system shall support binding: start/stop recording, start/stop streaming, replay buffer control, virtual camera toggle, screenshot | D |
| FR-13.4 | The system shall allow the user to record a binding by pressing the intended key combination | D |
| FR-13.5 | The system shall allow a binding to be removed | D |
| FR-13.6 | The system shall persist bindings across sessions | D |

## 3.14 Plugin System

| ID | Requirement | Priority |
|---|---|---|
| FR-14.1 | The system shall discover plugins placed in a designated directory | O |
| FR-14.2 | The system shall list installed plugins with name, version, and state | O |
| FR-14.3 | The system shall allow a plugin to be enabled, disabled, or uninstalled | O |
| FR-14.4 | The system shall execute plugin code in an isolated context without access to the host filesystem | O |
| FR-14.5 | The system shall provide access to the plugin directory from the interface | O |

## 3.15 Settings

| ID | Requirement | Priority |
|---|---|---|
| FR-15.1 | The system shall provide a settings interface organised into General, Video, Audio, Output, and Hotkeys | M |
| FR-15.2 | The system shall allow configuration of base and output resolution from standard presets | M |
| FR-15.3 | The system shall allow configuration of frame rate from standard values | M |
| FR-15.4 | The system shall allow configuration of downscale filter, colour format, colour space, and colour range | D |
| FR-15.5 | The system shall allow configuration of audio sample rate and channel count | D |
| FR-15.6 | The system shall persist all settings and restore them on next launch | M |
| FR-15.7 | The system shall provide Apply and Cancel actions, discarding changes on Cancel | M |

## 3.16 Automatic Updates

| ID | Requirement | Priority |
|---|---|---|
| FR-16.1 | The system shall check a configured endpoint for available updates | M |
| FR-16.2 | The system shall allow the user to initiate a check manually | M |
| FR-16.3 | The system shall display available version and release notes before installing | M |
| FR-16.4 | The system shall display download progress during installation | D |
| FR-16.5 | The system shall verify the cryptographic signature of an update and reject any update that fails verification | M |
| FR-16.6 | The system shall restart to complete installation, with user consent | M |
| FR-16.7 | The system shall continue to operate normally if the update endpoint is unreachable | M |

## 3.17 System Monitoring

| ID | Requirement | Priority |
|---|---|---|
| FR-17.1 | The system shall display current CPU utilisation | D |
| FR-17.2 | The system shall display current memory consumption | D |
| FR-17.3 | The system shall display render and encode frame rates during output | D |
| FR-17.4 | The system shall display output bitrate during recording or streaming | D |
| FR-17.5 | The system shall display dropped frame counts | D |

## 3.18 Dependency Handling

| ID | Requirement | Priority |
|---|---|---|
| FR-18.1 | The system shall detect at startup whether FFmpeg is available | M |
| FR-18.2 | If FFmpeg is unavailable, the system shall inform the user and provide installation guidance | M |
| FR-18.3 | If FFmpeg is unavailable, the system shall disable all functions requiring it, rather than allowing them to fail | M |
| FR-18.4 | The system shall remain usable for configuration when FFmpeg is unavailable | D |

---

# 4. Interface Requirements

## 4.1 User Interfaces

| ID | Requirement |
|---|---|
| UI-1 | The interface shall present a dockable panel layout, with panels for Scenes, Sources, Preview, Audio Mixer, and Controls |
| UI-2 | Panels shall be resizable, and the layout shall persist across sessions |
| UI-3 | The system shall provide a menu bar exposing File, Edit, View, Profile, Scene Collection, Plugins, Tools, and Help |
| UI-4 | The system shall provide a toolbar for frequently used actions |
| UI-5 | The system shall provide a status bar showing streaming state, recording state, performance statistics, and elapsed duration |
| UI-6 | Menu items reflecting a toggleable state shall indicate that state |
| UI-7 | Controls that cannot be operated in the current state shall be visibly disabled and shall explain why on hover |
| UI-8 | Destructive actions shall require confirmation |
| UI-9 | The interface shall use a dark visual theme |
| UI-10 | Window position and size shall persist across sessions |
| UI-11 | The interface shall remain responsive during recording, streaming, and encoding |

## 4.2 Hardware Interfaces

| ID | Requirement |
|---|---|
| HI-1 | The system shall capture video from any display attached to the host |
| HI-2 | The system shall capture video from any window on the host |
| HI-3 | The system shall capture video from connected camera devices |
| HI-4 | The system shall capture audio from connected input devices |
| HI-5 | The system shall enumerate available devices and present them for selection |
| HI-6 | The system shall use hardware-accelerated encoding where available, falling back to software encoding otherwise |

## 4.3 Software Interfaces

| Interface | Purpose | Notes |
|---|---|---|
| **FFmpeg** | Encoding, muxing, streaming, filtering | Invoked as a child process; version and licensing per section 6 |
| **SQLite** | Local persistence of scenes, sources, collections, plugins | Embedded; no server |
| **Operating system** | Display and window enumeration, audio devices, global shortcuts, filesystem | Windows APIs via the runtime |
| **Update endpoint** | Version manifest and installer delivery | HTTPS; signature-verified |
| **RTMP services** | Live stream destination | User-configured; any RTMP-compatible provider |

## 4.4 Communication Interfaces

| ID | Requirement |
|---|---|
| CI-1 | Outbound streaming shall use RTMP to a user-configured endpoint |
| CI-2 | Update checks shall use HTTPS |
| CI-3 | Update packages shall be cryptographically signed, and signatures verified before installation |
| CI-4 | The system shall make no other outbound network connection without explicit user action |
| CI-5 | Communication between the interface and backend processes shall use a typed, explicitly enumerated IPC surface; the interface shall not be granted general access to system APIs |

---

# 5. Performance Requirements

| ID | Requirement | Target |
|---|---|---|
| PR-1 | Application cold start to interactive | ≤ 5 seconds |
| PR-2 | Interface response to user input | ≤ 100 ms |
| PR-3 | Preview latency from capture to display | ≤ 200 ms |
| PR-4 | Recording start latency | ≤ 2 seconds |
| PR-5 | Idle memory consumption | ≤ 400 MB |
| PR-6 | Memory consumption while recording at 1080p30 | ≤ 700 MB |
| PR-7 | Application CPU overhead while recording, excluding encoding | ≤ 15% of one core |
| PR-8 | Sustained recording at 1920×1080, 30 fps, without dropped frames on reference hardware | Required |
| PR-9 | Sustained recording at 1920×1080, 60 fps, on reference hardware | Desirable |
| PR-10 | Audio meter refresh rate | ≥ 15 Hz |
| PR-11 | Scene switch time | ≤ 500 ms |
| PR-12 | Supported concurrent sources per scene | ≥ 8 |
| PR-13 | Supported scenes per collection | ≥ 50 |
| PR-14 | Continuous recording duration without degradation | ≥ 4 hours |

**Reference hardware** for performance acceptance: quad-core x86-64 processor at 2.5 GHz or above, 8 GB RAM, integrated graphics with hardware video encoding, SSD storage.

Targets PR-5 and PR-6 reflect the Electron runtime and are higher than would apply to a native implementation. This is an accepted consequence of the platform decision recorded in section 6.1.

---

# 6. Design Constraints

## 6.1 Platform and Technology

| ID | Constraint | Rationale |
|---|---|---|
| DC-1 | The application shall be built on Electron with a React and TypeScript interface | Single-language maintainability; client-approved decision |
| DC-2 | The backend process shall be implemented in TypeScript on Node.js | As above |
| DC-3 | Persistence shall use SQLite via an embedded library | No server dependency; established reliability |
| DC-4 | All media encoding shall be delegated to FFmpeg | Avoids implementing codecs; industry standard |
| DC-5 | The application shall target Windows 10 and 11, 64-bit | Client-defined scope for v1.0 |

The platform decision in DC-1 was taken to prioritise long-term maintainability by a TypeScript-capable team. It carries a known cost in installer size and memory consumption, reflected in PR-5 and PR-6.

## 6.2 Security

| ID | Constraint |
|---|---|
| DC-6 | The interface process shall run with context isolation enabled and direct Node.js integration disabled |
| DC-7 | All privileged operations shall be exposed through an explicitly enumerated IPC surface |
| DC-8 | A Content Security Policy shall be enforced in the interface process |
| DC-9 | Plugin code shall execute without access to the host filesystem or privileged APIs |
| DC-10 | Update packages shall be signature-verified before installation |
| DC-11 | Distributed installers shall be signed with an Authenticode certificate issued to the client |

## 6.3 Data

| ID | Constraint |
|---|---|
| DC-12 | All user data shall be stored on the local machine |
| DC-13 | Referential integrity shall be enforced at the database level, including cascading deletion of dependent records |
| DC-14 | The application shall not transmit user content, telemetry, or usage data without explicit opt-in |
| DC-15 | Stream keys and comparable secrets shall be stored locally and never logged |

## 6.4 Legal and Licensing

| ID | Constraint | Status |
|---|---|---|
| DC-16 | FFmpeg licensing must be resolved before distribution. Standard prebuilt FFmpeg binaries are GPL-licensed; distributing them within closed-source commercial software would impose source disclosure obligations. Either an LGPL-only build must be commissioned, or FFmpeg must remain a user-installed dependency. | **Unresolved — blocks release** |
| DC-17 | Patent licensing for H.264 and AAC may apply to commercial distribution, independently of FFmpeg's own licence. | **Unresolved — requires legal review** |
| DC-18 | An end-user licence agreement and privacy policy must be prepared and presented at installation. | **Not started** |
| DC-19 | Third-party open-source component licences must be catalogued and attribution included in the distributed product. | **Not started** |

Items DC-16 through DC-19 require the client's legal counsel. They are not engineering decisions and cannot be resolved by the development team.

---

# 7. Non-Functional Attributes

## 7.1 Security

| ID | Attribute |
|---|---|
| NF-1 | The application shall operate without administrative privileges |
| NF-2 | The application shall not open any listening network port accessible from outside the host |
| NF-3 | Secrets shall be excluded from log output and diagnostic reports |
| NF-4 | The application shall not execute code obtained over the network, except signature-verified updates |

## 7.2 Reliability

| ID | Attribute |
|---|---|
| NF-5 | An in-progress recording shall not be lost due to a failure elsewhere in the application |
| NF-6 | Failure of an external process shall be reported to the user, not silently absorbed |
| NF-7 | Corrupt or unreadable configuration shall cause a fallback to defaults, not a failure to start |
| NF-8 | The application shall recover from an unexpected termination without loss of persisted scenes or settings |
| NF-9 | An uncaught interface error shall present a recovery option rather than an unresponsive window |

## 7.3 Availability

| ID | Attribute |
|---|---|
| NF-10 | The application shall be fully functional without network connectivity, excepting streaming and updates |
| NF-11 | Unavailability of the update endpoint shall not impair any other function |

## 7.4 Maintainability

| ID | Attribute |
|---|---|
| NF-12 | The codebase shall be written in TypeScript with strict type checking enabled |
| NF-13 | Automated test coverage of the backend process shall be no less than 70% of statements |
| NF-14 | All requirements marked Mandatory shall have corresponding automated tests |
| NF-15 | The build shall be reproducible from a clean checkout with a documented command sequence |
| NF-16 | Released versions shall be archived and individually retrievable |
| NF-17 | Dependencies shall be pinned to explicit versions |

## 7.5 Portability

| ID | Attribute |
|---|---|
| NF-18 | Platform-specific code shall be isolated behind interfaces to permit later macOS and Linux support |
| NF-19 | No requirement in this specification shall preclude later cross-platform support |

## 7.6 Usability

| ID | Attribute |
|---|---|
| NF-20 | A first-time user shall be able to start a recording without consulting documentation |
| NF-21 | Error messages shall state what failed and what the user can do about it |
| NF-22 | Destructive actions shall be confirmed or reversible |
| NF-23 | Interface text shall be externalised to permit later localisation |

## 7.7 Supportability

| ID | Attribute |
|---|---|
| NF-24 | The application shall write diagnostic logs to a known local location |
| NF-25 | The application version and host platform shall be discoverable from within the interface |
| NF-26 | Crash reports shall be collectable, subject to user opt-in |

---

# 8. Preliminary Schedule and Budget

> The estimates in this section are preliminary. Effort is expressed in person-weeks; monetary values are limited to third-party costs, as internal rates are set by the client's commercial agreement.

## 8.1 Phase Structure

| Phase | Description | Status |
|---|---|---|
| **1** | Core application — scene composition, capture, recording, streaming, and supporting features | Complete |
| **2** | Hardening and commercial readiness | In progress |
| **3** | Launch and distribution | Not started |

## 8.2 Phase 2 — Effort Estimate

| Work item | Effort | Depends on |
|---|---|---|
| Platform migration to Electron | 1–2 weeks | — |
| Automated test suite | 2–3 weeks | Migration |
| Crash reporting and diagnostics | 0.5 week | Migration |
| Branding and identity application | 0.5 week | Client branding (AD-4) |
| Code signing integration | 0.5 week | Certificate (AD-3) |
| Legal documentation integration | 0.5 week | Client legal (DC-16 – DC-19) |
| Performance validation against section 5 | 1 week | Migration, test suite |
| **Total** | **6–8 weeks** | |

Test suite work is scheduled concurrently with the migration, since the existing implementation serves as the specification against which ported behaviour is verified.

## 8.3 Phase 3 — Indicative Effort

Phase 3 scope is not yet agreed. The following are indicative only and require separate specification.

| Candidate work item | Indicative effort |
|---|---|
| Public release and distribution setup | 1 week |
| Licence enforcement, activation, and payment | 4–6 weeks |
| macOS support, including capture rewrite and notarisation | 4–6 weeks |
| Linux support | 3–4 weeks |
| Localisation | 2–3 weeks |

Licence enforcement and cross-platform support are substantial bodies of work not present in the current product and not covered by this specification.

## 8.4 Third-Party Costs

| Item | Cost | Frequency | Required for |
|---|---|---|---|
| Windows Authenticode certificate | USD 200–600 | Annual | Public release |
| Apple Developer Program | USD 99 | Annual | macOS only |
| Update hosting | Nil | — | Public release |
| Crash reporting service | Nil to USD 300 | Annual | Depends on volume |
| Codec patent licensing | To be determined | — | Subject to DC-17 |

## 8.5 Critical Path

The following are prerequisites to public release and are outside the development team's control:

1. **Authenticode certificate procurement.** Business verification typically takes several days to several weeks. Without it, users encounter a full-screen Windows warning identifying the application as unrecognised, which materially depresses installation completion.
2. **FFmpeg licensing determination (DC-16).** Determines whether FFmpeg may be bundled, which in turn determines the installation experience.
3. **Branding finalisation (AD-4).** The bundle identifier must be fixed before first public release; changing it afterwards relocates application data and results in loss of user settings.

Item 1 has the longest lead time and should be initiated immediately.

---

# 9. Appendices

## Appendix A — Requirement to Release Map

| Module | Requirements | Target release |
|---|---|---|
| Scene management | FR-1.1 – FR-1.8 | v1.0 |
| Source management | FR-2.1 – FR-2.10 | v1.0 |
| Preview and Studio Mode | FR-3.1 – FR-3.8 | v1.0 |
| Audio mixing | FR-4.1 – FR-4.8 | v1.0 |
| Recording | FR-5.1 – FR-5.10 | v1.0 |
| Streaming | FR-6.1 – FR-6.7 | v1.0 |
| Replay buffer | FR-7.1 – FR-7.5 | v1.0 |
| Virtual camera | FR-8.1 – FR-8.3 | v1.0 |
| Screenshots | FR-9.1 – FR-9.3 | v1.0 |
| Scene filters | FR-10.1 – FR-10.5 | v1.0 |
| Scene collections | FR-11.1 – FR-11.6 | v1.0 |
| Profiles | FR-12.1 – FR-12.4 | v1.0 |
| Hotkeys | FR-13.1 – FR-13.6 | v1.0 |
| Plugins | FR-14.1 – FR-14.5 | v1.0 |
| Settings | FR-15.1 – FR-15.7 | v1.0 |
| Automatic updates | FR-16.1 – FR-16.7 | v1.0 |
| System monitoring | FR-17.1 – FR-17.5 | v1.0 |
| Dependency handling | FR-18.1 – FR-18.4 | v1.0 |
| Licence enforcement | Not specified | Future |
| macOS support | Not specified | Future |
| Linux support | Not specified | Future |
| Localisation | Not specified | Future |

## Appendix B — Open Items

| Ref | Item | Owner | Blocks release |
|---|---|---|---|
| OI-1 | FFmpeg licensing determination (DC-16) | Client legal | Yes |
| OI-2 | Codec patent position (DC-17) | Client legal | Yes |
| OI-3 | Authenticode certificate procurement (AD-3) | Client | Yes |
| OI-4 | Branding and bundle identifier (AD-4) | Client | Yes |
| OI-5 | End-user licence agreement and privacy policy (DC-18) | Client legal | Yes |
| OI-6 | Third-party licence attribution (DC-19) | Development team | Yes |
| OI-7 | Commercial model — free, paid, or trial | Client | No, but determines Phase 3 |
| OI-8 | Platform scope beyond Windows | Client | No, but determines Phase 3 |
| OI-9 | Reference hardware confirmation for section 5 | Client | No |

## Appendix C — Acceptance Criteria

The release shall be considered acceptable when all of the following hold:

1. Every requirement marked **Mandatory** in section 3 is implemented and verified by automated test
2. Every performance target marked **Required** in section 5 is met on reference hardware
3. Automated test coverage of the backend process is no less than 70% of statements (NF-13)
4. The distributed installer is Authenticode-signed and installs without a SmartScreen warning
5. Every item in Appendix B marked as blocking release is closed
6. A four-hour continuous recording completes without dropped frames or memory growth (PR-14)
7. The application starts and remains usable on a host without FFmpeg installed (FR-18.4)

## Appendix D — Document Control

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0 | 9 August 2026 | Development Team | Initial specification |

*Requirement identifiers are stable across revisions. Superseded requirements are marked withdrawn rather than removed, so that identifiers are never reused.*

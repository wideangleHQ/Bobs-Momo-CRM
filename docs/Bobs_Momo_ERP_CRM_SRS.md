# Software Requirements Specification
## Bob's Momo ERP & CRM

**Prepared by:** Wide Angle Media and Technologies
**For:** Bob's Momo, Bhubaneswar, Odisha
**Document Version:** 1.0
**Date:** 16 August 2026

---

## Document Control

### Version History

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 16-Aug-2026 | Wide Angle Media and Technologies | Initial SRS release based on client discovery requirements |

### Document Purpose

This SRS defines the functional and technical requirements for the Bob's Momo ERP & CRM system, to be designed and developed by Wide Angle Media and Technologies. It is the primary reference for design, development, testing and acceptance during the 3-week delivery cycle. All requirements are sourced from client discovery discussions; unclear items are marked TBC and consolidated in the Open Questions section.

### Distribution

Bob's Momo (Owner / Management) and Wide Angle Media and Technologies (Development Team).

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [AS-IS Analysis](#2-as-is-analysis)
3. [TO-BE Architecture & Scope Overview](#3-to-be-architecture--scope-overview)
4. [Technology Stack](#4-technology-stack)
5. [User Roles & Permissions](#5-user-roles--permissions)
6. [Module Architecture](#6-module-architecture)
7. [Inventory Management](#7-inventory-management)
8. [Purchase & Vendor Management](#8-purchase--vendor-management)
9. [Employee / Workforce Management](#9-employee--workforce-management)
10. [Tasks, Checklists & Operational Audits](#10-tasks-checklists--operational-audits)
11. [Game Engine & Reward Configuration](#11-game-engine--reward-configuration)
12. [Customer Game CRM](#12-customer-game-crm)
13. [Management & Analytics / Reporting](#13-management--analytics--reporting)
14. [Notification Architecture](#14-notification-architecture)
15. [Functional Requirements](#15-functional-requirements)
16. [System Architecture](#16-system-architecture)
17. [Database Overview](#17-database-overview)
18. [Non-Functional Requirements](#18-non-functional-requirements)
19. [Third-Party Integrations](#19-third-party-integrations)
20. [Deployment & Infrastructure Cost](#20-deployment--infrastructure-cost)
21. [Delivery Timeline (3 Weeks)](#21-delivery-timeline-3-weeks)
22. [Testing & UAT](#22-testing--uat)
23. [Assumptions & Constraints](#23-assumptions--constraints)
24. [Future Scope (Post Phase 1)](#24-future-scope-post-phase-1)
25. [Out of Scope](#25-out-of-scope)
26. [Requirements Traceability Matrix](#26-requirements-traceability-matrix)
27. [Acceptance Criteria](#27-acceptance-criteria)
28. [Client & Agency Responsibilities](#28-client--agency-responsibilities)
29. [Open Questions (TBC / Client Confirmation Required)](#29-open-questions-tbc--client-confirmation-required)
30. [Sign-Off](#30-sign-off)

---

## 1. Executive Summary

Bob's Momo operates 2 outlets in Bhubaneswar serving momo, thukpa, Laphing, spring rolls and Pan-Asian food. Day-to-day operations — inventory, sales reporting, duty rosters, kitchen opening/closing, and stock updates — currently run on paper registers, Excel sheets and WhatsApp messages, with no centralized system of record.

Wide Angle Media and Technologies will design and build a unified, web-based ERP & CRM covering Operations, Workforce, Customer Experience (Game CRM), Management Analytics and Internal Communication. The system is being delivered as a lean, automation-first Phase 1 MVP within a 3-week timeline, avoiding unnecessary approval layers so it fits the speed and simplicity a QSR business needs.

Development cost: ₹45,000 (one-time). Target ongoing maintenance and infrastructure: under ₹5,000/month, based on the hosting stack detailed in Section 20.

### Guiding Workflow Philosophy

> **USER ACTION → SYSTEM RECORDS EVENT → BUSINESS RULE → AUTOMATION → NOTIFICATION IF REQUIRED → MANAGEMENT VISIBILITY**

Routine, repetitive actions are automated. Human intervention is reserved for genuine decisions, exceptions or approvals (e.g., leave approval, low-stock reorder decisions) — not for verifying routine tasks.

---

## 2. AS-IS Analysis

| Area | Current Method | Problem |
|---|---|---|
| Inventory | Paper registers | No digitized opening/issued/restocked/closing tracking |
| Sales Reporting | WhatsApp messages | No structured, queryable sales data |
| Duty Roster | WhatsApp messages | No centralized shift/attendance visibility |
| Kitchen Open/Close | WhatsApp messages | No auditable checklist trail |
| Stock Updates | WhatsApp messages | Stock status scattered, not real-time |
| Purchase Pricing | Manual / verbal | No visibility into daily price fluctuation for costing |
| Attendance/Leave/Break | Manual / WhatsApp | Difficult to know who is working, on leave, or on break |
| Salary & Leave History | Manual records | Difficult to track historically |
| Task Assignment & Audits | Manual / verbal | No structured tracking or accountability |
| Internal Communication | WhatsApp only | No structured chat/alerts/broadcast within a system of record |
| Customer Engagement | Website games (isolated) | Scores/coins/rewards not connected to management visibility |

---

## 3. TO-BE Architecture & Scope Overview

The ERP & CRM will be organized into five business pillars, detailed in Section 6:

- **Operations Management** — Inventory, Purchase, Vendors, Kitchen Operations, Tasks, SOPs, Checklists, Audits
- **Workforce Management** — Employees, Attendance, Shifts, Breaks, Leave, Salary information, Performance, RBAC
- **Customer Experience / Game CRM** — Customer database, game scores, coins, rewards, offers, coupons, QR redemption, leaderboards
- **Management & Analytics** — Dashboards, Daily Sales, Inventory Consumption, Employee Performance, Reward Trends, P&L, Waste Analysis
- **Internal Communication** — Chat, Alerts, Broadcasts, Task/Operational notifications, WhatsApp notifications where appropriate

### 3.1 Scope Classification

| Category | Definition |
|---|---|
| Phase 1 / Committed Scope | Modules and workflows explicitly detailed in this SRS, to be delivered within the 3-week timeline against the ₹45,000 development cost. |
| Minor Refinements | Small changes to UI, workflows, field structures and implementation details during planning/design/development/testing, accommodated within agreed scope. |
| Third-Party Dependent Functionality | Features dependent on external providers (e.g., WhatsApp Business API) — subject to provider approval, availability and usage pricing. |
| Future Scope | Hardware integrations and enhancements explicitly deferred beyond Phase 1 (Section 24). |
| Out of Scope | Items not committed under this SRS or the current commercial agreement (Section 25). |

> *Minor changes to UI, workflows, field structures and implementation details may be refined during the planning, design, development and testing phases based on practical operational requirements. Such refinements will be accommodated where they remain within the agreed project scope. Major new modules or materially expanded functionality will require separate evaluation and approval.*

---

## 4. Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| Frontend | Next.js | Modern React-based web application layer, SSR/SSG support |
| Backend | NestJS (TypeScript) | Modular, maintainable, testable backend architecture |
| Runtime | Bun | Fast startup and efficient execution |
| Database | PostgreSQL (via Supabase) | Reliable relational data management; managed backups/storage |
| ORM | Prisma | Type-safe schema and query layer |
| Cache / Queue | Upstash Redis | Caching and background processing where required |
| Backend Hosting | Railway | Managed backend application hosting |
| Notifications | WhatsApp Business API | Where applicable, provider-dependent |
| Authentication | Custom auth (credentials/session/token) + RBAC | Google OAuth explicitly excluded per client instruction |

### 4.1 Hardware Integration — Explicitly Out of Phase 1

Thermal printers, barcode scanners, Kitchen Display Systems (KDS), customer displays, biometric devices and cash drawers are removed from Phase 1 architecture and scope. All inventory, purchase, and operational data entry will be manual (web-based forms) in Phase 1. Hardware integrations are documented only under Future Scope (Section 24).

---

## 5. User Roles & Permissions

RBAC restricts users to relevant outlet and module data. Exact permission matrices per module will be finalized during design; the following defines the baseline role set and general access intent.

| Role | General Access Scope |
|---|---|
| Owner | Full access across all outlets, all modules, financial and analytics data |
| Operations Manager | Cross-outlet operations, inventory, purchase, tasks, audits |
| Store Manager | Single-outlet operations, employee attendance/shift, tasks, checklists |
| Kitchen Manager | Kitchen operations, inventory issue/consumption, kitchen checklists |
| Kitchen Staff | Assigned tasks, checklist completion, break/attendance self-service |
| Counter / Cashier | Sales entry (where applicable), assigned tasks, attendance self-service |
| Inventory Manager | Inventory items, stock transactions, low-stock alerts, stock history |
| Purchase Manager | Vendors, purchase requests/records, price history |
| HR / Accounts | Employee profiles, attendance, leave, salary information |

> **TBC / Client Confirmation Required:** Final field-level and action-level permission matrix per role/module to be confirmed during design sprint (Week 1).

---

## 6. Module Architecture

### 6.1 Operations Management
Inventory, Purchase, Vendors, Kitchen Operations, Tasks, SOPs, Checklists, Audits — see Sections 7 (Inventory), 8 (Purchase/Vendor) and 10 (Tasks & Operations) for detailed workflows.

### 6.2 Workforce Management
Employees, Attendance, Shifts, Breaks, Leave, Salary information, Performance visibility, RBAC. Covers employee profile (outlet, department, role), shift/attendance/break logging, leave request-approval-notify workflow, historical leave and salary information storage, and performance/activity visibility for managers.

### 6.3 Customer Experience / Game CRM
Customer database, game scores, coins, rewards, offers, coupons, QR-based redemption, leaderboards, activity history and basic fraud/abuse controls. Full workflow detailed in Sections 11 and 12.

### 6.4 Management & Analytics
A management dashboard consolidating Daily Sales Summary, Inventory Consumption, Employee Performance, Customer Game/Reward Activity, P&L Overview (where data availability permits) and Waste Analysis. Detailed in Section 13.

### 6.5 Internal Communication
Chat, Alerts, Broadcasts, Task notifications, Operational notifications, and WhatsApp notifications where appropriate. The ERP database remains the system of record; WhatsApp is a delivery channel only, never the primary store. Event-driven notification rules are detailed in Section 14.

---

## 7. Inventory Management

### 7.1 Core Workflow

> **Opening Stock → Stock Received / Restocked → Stock Issued / Consumed → Wastage / Adjustment → Closing Stock**

### 7.2 Scope

- Items, Categories, Units master data
- Outlet-wise stock tracking
- Stock transactions (receive, issue, adjust, wastage)
- Manual stock entry (no barcode/scanner in Phase 1)
- Consumption tracking
- Wastage recording
- Low-stock alerts (threshold-based, configurable per item)
- Stock transaction history
- Basic outlet-to-outlet transfer capability if required

> **TBC:** Whether basic stock transfer between the 2 outlets is required for Phase 1, and low-stock threshold values per item.

---

## 8. Purchase & Vendor Management

- Vendor master data (name, contact, item categories supplied)
- Purchase requests (Purchase Requested → Manager Notified → Approve/Reject → Recorded)
- Purchase records: items purchased, quantity, unit price
- Daily purchase price capture and price history per item/vendor
- Vendor–item relationship tracking
- Basic purchase tracking and reporting inputs for costing

Management gains visibility into daily purchase pricing and price fluctuation, supporting costing decisions, without adding multi-level purchase-approval overhead beyond the single manager-decision step above.

---

## 9. Employee / Workforce Management

- Employee profile: name, contact, outlet, department, role
- Attendance logging (check-in/check-out)
- Shift assignment and roster (replacing WhatsApp-based rostering)
- Break logging (start/end, duration)
- Leave request workflow: Leave Requested → Manager Notified → Approve/Reject → Employee Notified
- Leave history (historical record, replacing manual tracking)
- Salary information storage (base structure; payroll computation TBC)
- Task assignment linkage (see Section 10)
- Performance / activity visibility for managers (task completion rate, attendance consistency)

> **TBC:** Whether salary computation/payroll processing (deductions, payslips) is in Phase 1 scope, or storage of salary information only. Whether biometric/photo-based attendance is required — currently manual entry per hardware exclusion.

---

## 10. Tasks, Checklists & Operational Audits

### 10.1 Core Workflow

> **Task Created → Assigned → Notification → In Progress → Completed**

No manager approval is required for routine task completion. Verification exists only where a specific task or business rule genuinely requires it (e.g., an audit checklist flagged as failed).

### 10.2 Scope

- One-time tasks and recurring tasks
- Outlet-level and department-level tasks
- Priority and due date
- Comments on tasks
- Optional proof/photo attachment on completion
- Completion status tracking
- Overdue notification to manager
- Manager visibility across all assigned tasks

### 10.3 Shared Engine — Checklists & Audits

The same task engine powers: Opening Checklist, Closing Checklist, Cleaning Checklist, Kitchen Checklist, Equipment/SOP Checklist, and Operational Audits — avoiding a separate, duplicate module for each.

---

## 11. Game Engine & Reward Configuration

Designed as a content/reward management flow — not a multi-step CRM approval system.

### 11.1 Admin Configuration Capabilities

Game, Coin/reward value, Offer value, Reward type, Reward quantity/limits, Validity/expiry, Eligibility, Status (active/inactive/draft).

### 11.2 Publishing Flow

> **Admin Dashboard → Configure Game/Coins/Offer → Save Draft → Publish → Website receives updated configuration → Customer plays game → Score/coins recorded → Reward eligibility calculated → Reward issued → Customer notified → Redemption recorded**

### 11.3 Architecture Principle

The game/reward configuration is exposed to the website/game layer through secure APIs, keeping the ERP decoupled from any single specific game implementation — supporting the existing website games and future games without tight coupling.

---

## 12. Customer Game CRM

- Customer identity / contact where available
- Games played, scores, coins
- Rewards and offers earned
- Redemption history
- Activity timeline
- Leaderboard data
- Coupon / voucher information
- QR-based reward redemption
- Reward expiry tracking
- Basic fraud/abuse controls (e.g., rate-limiting score submissions, duplicate-redemption prevention) where practical within timeline

> **TBC:** Extent of fraud/abuse control sophistication achievable within the 3-week timeline; source and completeness of customer contact data capture (phone/email/guest).

---

## 13. Management & Analytics / Reporting

| Report | Depends On |
|---|---|
| Daily Sales Summary | Availability and structure of sales/financial data — not assumed to have an existing POS API unless confirmed |
| Inventory Consumption Report | Inventory transaction data captured via Section 7 workflow |
| Employee Performance Metrics | Task completion and attendance data captured via Sections 9–10 |
| Customer Game / Reward Trends | Game/CRM activity data captured via Sections 11–12 |
| P&L Overview | Availability and structure of sales and cost data; scope limited to what data availability permits |
| Waste Analysis | Wastage/adjustment transactions captured via Section 7 workflow |

> **TBC:** Whether an existing POS system/API exists for sales data ingestion, or whether daily sales will be entered manually into the ERP in Phase 1.

---

## 14. Notification Architecture

Event-driven notifications only — no polling or manual status checks required. WhatsApp is used as a delivery channel where appropriate; the ERP database remains the system of record in all cases.

| Event | Notified |
|---|---|
| Low Stock | Relevant Manager |
| Task Assigned | Employee |
| Task Overdue | Manager |
| Leave Request | Manager |
| Leave Decision | Employee |
| Purchase Request | Relevant Manager |
| Important Broadcast | Selected Outlet / Department |
| Reward Issued | Customer |
| Operational Alert | Relevant Staff |

---

## 15. Functional Requirements

Each requirement is uniquely identified. Priority: **Must-Have** (Phase 1 committed), **Should-Have** (Phase 1 if timeline permits), **Could-Have** (candidate for Future Scope).

### 15.1 Authentication & Access

#### FR-AUTH-001 — Custom User Login
| Field | Detail |
|---|---|
| Description | Users authenticate using a username/email and password via custom authentication (no Google OAuth). |
| Actor(s) | All roles |
| Preconditions | User account provisioned by admin |
| Main Flow | 1) User enters credentials 2) System validates 3) Session/token issued |
| Expected Result | Authenticated session with role-scoped access |
| Exceptions / Business Rules | Account lockout after repeated failed attempts; passwords securely hashed |
| Priority | Must-Have |

#### FR-AUTH-002 — Role-Based Access Control
| Field | Detail |
|---|---|
| Description | System restricts module and outlet-level data access based on assigned role. |
| Actor(s) | All roles |
| Preconditions | Role assigned to user |
| Main Flow | 1) User logs in 2) System loads role permissions 3) UI/API restrict accordingly |
| Expected Result | User sees only permitted modules/outlets |
| Exceptions / Business Rules | Unauthorized API calls rejected with 403 |
| Priority | Must-Have |

#### FR-AUTH-003 — Session/Token Management
| Field | Detail |
|---|---|
| Description | Secure session or token issuance, refresh, and expiry. |
| Actor(s) | All roles |
| Preconditions | User authenticated |
| Main Flow | 1) Token issued on login 2) Token validated per request 3) Token expires/refreshes per policy |
| Expected Result | Sessions expire securely; no indefinite tokens |
| Exceptions / Business Rules | Expired/revoked tokens rejected |
| Priority | Must-Have |

### 15.2 Inventory

#### FR-INV-001 — Record Stock Transaction
| Field | Detail |
|---|---|
| Description | Record opening, received/restocked, issued/consumed, wastage/adjustment, and closing stock entries. |
| Actor(s) | Inventory Manager, Kitchen Manager |
| Preconditions | Item exists in master data; user has outlet access |
| Main Flow | 1) User selects item/outlet 2) Enters transaction type and quantity 3) System saves and updates running stock |
| Expected Result | Stock ledger updated; current stock reflects transaction |
| Exceptions / Business Rules | Negative stock flagged; wastage requires reason field |
| Priority | Must-Have |

#### FR-INV-002 — Low Stock Alert
| Field | Detail |
|---|---|
| Description | Automatically notify relevant manager when stock falls below configured threshold. |
| Actor(s) | System (automated) |
| Preconditions | Threshold configured per item |
| Main Flow | 1) Stock transaction reduces quantity 2) System checks against threshold 3) Notification triggered if breached |
| Expected Result | Manager notified in near real-time |
| Exceptions / Business Rules | No duplicate alerts within a configurable cooldown window |
| Priority | Must-Have |

#### FR-INV-003 — Stock History & Consumption View
| Field | Detail |
|---|---|
| Description | View historical stock transactions and consumption trends per item/outlet. |
| Actor(s) | Inventory Manager, Owner, Operations Manager |
| Preconditions | Transactions exist |
| Main Flow | 1) User selects item/outlet/date range 2) System returns transaction list/summary |
| Expected Result | Accurate consumption view for reporting |
| Exceptions / Business Rules | Empty state shown if no data in range |
| Priority | Should-Have |

### 15.3 Purchase & Vendor

#### FR-PUR-001 — Create Purchase Request
| Field | Detail |
|---|---|
| Description | Raise a purchase request for items needed at an outlet. |
| Actor(s) | Store Manager, Kitchen Manager |
| Preconditions | Item/vendor master data exists |
| Main Flow | 1) User selects items/quantities 2) Submits request 3) Relevant manager notified |
| Expected Result | Purchase request recorded and visible to Purchase Manager |
| Exceptions / Business Rules | No multi-level approval chain — single manager decision |
| Priority | Must-Have |

#### FR-PUR-002 — Record Purchase & Price
| Field | Detail |
|---|---|
| Description | Record a completed purchase with vendor, items, quantity and unit price. |
| Actor(s) | Purchase Manager |
| Preconditions | Vendor exists in master data |
| Main Flow | 1) User selects vendor/items 2) Enters quantity and unit price 3) Saves purchase record |
| Expected Result | Purchase recorded; inventory received via FR-INV-001; price history updated |
| Exceptions / Business Rules | Price entered per unit per date to build price-fluctuation history |
| Priority | Must-Have |

#### FR-PUR-003 — View Price History
| Field | Detail |
|---|---|
| Description | View historical purchase price trend per item/vendor for costing visibility. |
| Actor(s) | Owner, Purchase Manager |
| Preconditions | Purchase records exist |
| Main Flow | 1) User selects item 2) System displays price-over-time view |
| Expected Result | Management sees price fluctuation for costing decisions |
| Exceptions / Business Rules | N/A |
| Priority | Should-Have |

### 15.4 Employee & Workforce

#### FR-EMP-001 — Employee Profile Management
| Field | Detail |
|---|---|
| Description | Create and maintain employee profile with outlet, department and role. |
| Actor(s) | HR/Accounts, Owner |
| Preconditions | N/A |
| Main Flow | 1) Admin enters employee details 2) Assigns outlet/department/role 3) Saves profile |
| Expected Result | Employee record available system-wide for attendance/tasks/leave |
| Exceptions / Business Rules | Role must map to a defined RBAC role |
| Priority | Must-Have |

#### FR-EMP-002 — Attendance, Shift & Break Logging
| Field | Detail |
|---|---|
| Description | Record employee attendance, shift assignment, and break start/end. |
| Actor(s) | All employees (self), Store Manager (oversight) |
| Preconditions | Employee profile exists |
| Main Flow | 1) Employee checks in/out 2) System logs timestamp 3) Manager views live status |
| Expected Result | Manager can see who is working, on break, or absent in real time |
| Exceptions / Business Rules | Overlapping shift/break entries flagged |
| Priority | Must-Have |

#### FR-EMP-003 — Leave Request & Approval
| Field | Detail |
|---|---|
| Description | Employee requests leave; manager approves or rejects; employee notified. |
| Actor(s) | Employee, Store Manager |
| Preconditions | Employee profile exists |
| Main Flow | 1) Employee submits leave request 2) Manager notified 3) Manager approves/rejects 4) Employee notified |
| Expected Result | Leave decision recorded in history |
| Exceptions / Business Rules | No further approval layer beyond the single manager decision |
| Priority | Must-Have |

#### FR-EMP-004 — Leave & Salary History
| Field | Detail |
|---|---|
| Description | Maintain historical leave records and store salary information per employee. |
| Actor(s) | HR/Accounts, Owner |
| Preconditions | Employee profile exists |
| Main Flow | 1) HR views/updates leave history 2) HR maintains salary information |
| Expected Result | Accurate historical record replacing manual tracking |
| Exceptions / Business Rules | Access restricted to HR/Accounts and Owner |
| Priority | Must-Have |

### 15.5 Tasks & Operations

#### FR-TASK-001 — Create & Assign Task
| Field | Detail |
|---|---|
| Description | Create one-time or recurring task and assign to employee/outlet/department. |
| Actor(s) | Managers |
| Preconditions | Employee/outlet exists |
| Main Flow | 1) Manager creates task with priority/due date 2) Assigns to employee 3) Employee notified |
| Expected Result | Task appears in assignee's task list |
| Exceptions / Business Rules | Recurring tasks auto-generate next instance on schedule |
| Priority | Must-Have |

#### FR-TASK-002 — Complete Task
| Field | Detail |
|---|---|
| Description | Employee updates task status to in-progress/completed, optionally attaching proof/photo. |
| Actor(s) | Employee |
| Preconditions | Task assigned to employee |
| Main Flow | 1) Employee opens task 2) Updates status 3) Optionally attaches photo/comment |
| Expected Result | Status updated; manager sees completion without needing to approve routine tasks |
| Exceptions / Business Rules | Verification required only where the specific task/business rule flags it |
| Priority | Must-Have |

#### FR-TASK-003 — Overdue Task Notification
| Field | Detail |
|---|---|
| Description | Automatically notify manager when a task passes its due date incomplete. |
| Actor(s) | System (automated) |
| Preconditions | Task has due date |
| Main Flow | 1) System checks due dates 2) Flags overdue tasks 3) Notifies manager |
| Expected Result | Manager alerted without manual follow-up |
| Exceptions / Business Rules | N/A |
| Priority | Must-Have |

#### FR-TASK-004 — Checklist / Audit Execution
| Field | Detail |
|---|---|
| Description | Execute Opening/Closing/Cleaning/Kitchen/SOP checklists and operational audits using the task engine. |
| Actor(s) | Kitchen Staff, Store Manager |
| Preconditions | Checklist template configured |
| Main Flow | 1) Employee opens checklist 2) Marks each item 3) Submits |
| Expected Result | Checklist completion recorded with timestamp |
| Exceptions / Business Rules | Failed audit items can trigger a follow-up task |
| Priority | Must-Have |

### 15.6 Game / Reward Configuration

#### FR-GAME-001 — Configure & Publish Game/Reward
| Field | Detail |
|---|---|
| Description | Admin configures game, coin/reward value, offer, eligibility, validity and publishes live to the website. |
| Actor(s) | Owner, Operations Manager |
| Preconditions | N/A |
| Main Flow | 1) Admin configures parameters 2) Saves draft 3) Publishes 4) Website consumes updated config via API |
| Expected Result | Live configuration reflected on website without code deployment |
| Exceptions / Business Rules | Draft changes do not affect live config until published |
| Priority | Must-Have |

#### FR-GAME-002 — Record Score & Calculate Reward
| Field | Detail |
|---|---|
| Description | Record customer game score/coins and calculate reward eligibility per published configuration. |
| Actor(s) | System (automated), Customer (via website) |
| Preconditions | Game configuration published |
| Main Flow | 1) Customer plays game 2) Website submits score via API 3) System calculates eligibility 4) Reward issued if eligible |
| Expected Result | Reward issued and customer notified |
| Exceptions / Business Rules | Duplicate/abnormal submissions flagged per basic fraud controls |
| Priority | Must-Have |

### 15.7 Customer CRM

#### FR-CRM-001 — Customer Profile & Activity
| Field | Detail |
|---|---|
| Description | Maintain customer profile with identity/contact, activity timeline, and redemption history. |
| Actor(s) | System (automated), Owner, Operations Manager |
| Preconditions | Customer engages via website game |
| Main Flow | 1) Customer identified (contact/guest) 2) Activity recorded 3) Profile updated |
| Expected Result | Consolidated customer activity view for management |
| Exceptions / Business Rules | Guest vs identified customer handling TBC |
| Priority | Must-Have |

#### FR-CRM-002 — QR Reward Redemption
| Field | Detail |
|---|---|
| Description | Redeem an issued reward via QR code at the outlet. |
| Actor(s) | Counter/Cashier, Customer |
| Preconditions | Reward issued and unexpired |
| Main Flow | 1) Customer presents QR 2) Staff scans/enters code 3) System validates and marks redeemed |
| Expected Result | Redemption recorded; reward cannot be redeemed twice |
| Exceptions / Business Rules | Expired/already-redeemed codes rejected with clear message |
| Priority | Must-Have |

### 15.8 Notifications & Communication

#### FR-NOTIF-001 — Event-Driven Notification Dispatch
| Field | Detail |
|---|---|
| Description | Dispatch in-app and/or WhatsApp notifications automatically per the event table in Section 14. |
| Actor(s) | System (automated) |
| Preconditions | Notification event configured |
| Main Flow | 1) Business event occurs 2) System matches event rule 3) Notification dispatched to relevant user(s) |
| Expected Result | Recipient notified without manual triggering |
| Exceptions / Business Rules | WhatsApp delivery dependent on provider API availability/approval |
| Priority | Must-Have |

#### FR-NOTIF-002 — Internal Chat & Broadcast
| Field | Detail |
|---|---|
| Description | Send direct chat messages and outlet/department-wide broadcasts within the system. |
| Actor(s) | All roles (chat), Managers (broadcast) |
| Preconditions | Recipient(s) exist in system |
| Main Flow | 1) User composes message 2) Selects recipient/scope 3) System delivers and stores message |
| Expected Result | Message delivered and retained as system of record |
| Exceptions / Business Rules | N/A |
| Priority | Should-Have |

---

## 16. System Architecture

### 16.1 High-Level Architecture
Next.js frontend (web application, admin dashboard, and website game integration layer) communicates over secure REST APIs with a NestJS backend running on the Bun runtime. The backend uses Prisma as the ORM against a PostgreSQL database hosted on Supabase. Upstash Redis provides caching and background job/queue support. The backend is deployed on Railway; the frontend is deployed via Next.js production hosting. WhatsApp Business API integration handles outbound notifications where applicable.

### 16.2 Frontend Architecture
Next.js application with role-based routing: an internal Admin/Ops Dashboard (Operations, Workforce, Analytics, Game configuration) and the customer-facing website game layer, which consumes game/reward configuration and submits scores through secured APIs.

### 16.3 Backend Architecture
NestJS modular architecture, with one module per business domain (Auth, Inventory, Purchase, Employee, Task, Game, CRM, Notification), each exposing REST controllers, services, and Prisma-backed repositories. Shared modules: RBAC guard, audit logging, notification dispatcher.

### 16.4 Database Architecture
PostgreSQL via Supabase (managed backups, storage). Prisma schema defines entities with only business-justified relationships — no unnecessary normalization.

### 16.5 API Architecture
RESTful APIs, versioned (e.g., `/api/v1/...`), secured via token-based authentication and RBAC middleware. The website game layer consumes a scoped, secured subset of APIs for configuration retrieval and score/redemption submission.

### 16.6 Authentication / Authorization
Custom credential-based authentication with secure password hashing, session/token issuance and expiry, and RBAC enforced at both API and UI layers. Google OAuth is explicitly excluded.

### 16.7 Notification Architecture
Event-driven dispatcher triggered by domain events (see Section 14), delivering in-app notifications and, where appropriate, WhatsApp Business API messages. The ERP database is always the system of record.

### 16.8 Redis Usage
Upstash Redis is used for caching frequently read data (e.g., published game configuration, dashboard summaries) and lightweight background job/queue processing (e.g., notification dispatch), reducing database load.

### 16.9 Game Integration Architecture
Game/reward configuration is published from the Admin Dashboard and cached for fast retrieval by the website layer. Score/coin submissions and redemption requests flow back into the ERP through dedicated, secured API endpoints, decoupling the ERP from any single game implementation.

### 16.10 Deployment Architecture

| Component | Platform |
|---|---|
| Backend (NestJS) | Railway |
| Database / Storage / Backups | Supabase (PostgreSQL) |
| Cache / Queue | Upstash Redis |
| Frontend | Next.js production hosting |

### 16.11 Backup & Recovery
Daily automated backups via Supabase, retained per the plan's retention window (7 days on Supabase Pro at time of writing). Recovery procedure to be documented in the deployment runbook during Week 1.

### 16.12 Environment Strategy
Separate staging and production environments where feasible within budget; environment variables (database URL, Redis credentials, WhatsApp API credentials, auth secrets) managed via Railway/Supabase secret management — never committed to source control.

---

## 17. Database Overview

Major entities and relationships (Prisma schema, PostgreSQL). Only business-justified relationships are modeled — no speculative normalization.

| Entity | Purpose / Key Relationships |
|---|---|
| User | System login account; linked to Employee or Admin role |
| Role | Defines RBAC permission set; assigned to User |
| Employee | Profile; belongs to Outlet and Department; linked to User |
| Outlet | Physical outlet (2 initially); scopes most operational data |
| Department | Grouping within an Outlet (Kitchen, Counter, etc.) |
| Attendance | Check-in/out records per Employee |
| Shift | Roster assignment per Employee per date |
| Leave | Leave requests and history per Employee |
| Task | Assignable unit of work; linked to Employee, Outlet, optional Checklist |
| Checklist / SOP | Template consumed by Task engine for recurring operational checks |
| InventoryItem | Master item; belongs to Category, Unit |
| InventoryTransaction | Opening/received/issued/wastage/closing entries per Item per Outlet |
| Vendor | Supplier master data |
| Purchase | Purchase record; linked to Vendor |
| PurchaseItem | Line item within a Purchase; linked to InventoryItem, quantity, unit price |
| Customer | Customer identity/contact; linked to game activity |
| Game | Game definition consumed by website layer |
| GameConfiguration | Versioned config (coins/offer/eligibility/validity); draft/published state |
| GameScore | Score submissions per Customer per Game |
| CoinTransaction | Coin earn/spend ledger per Customer |
| Reward | Reward definition and issuance record |
| Offer | Promotional offer definition |
| Coupon | Issued voucher/coupon linked to a Reward or Offer |
| Redemption | Redemption event linked to Coupon/Reward and Customer |
| Notification | Dispatched notification record (event, recipient, channel, status) |
| Broadcast | Outlet/department-wide message |
| AuditLog | System-wide action log for accountability |

> **TBC:** Full ER diagram and field-level schema to be finalized in Week 1 during database design against this entity list.

---

## 18. Non-Functional Requirements

| Category | Requirement |
|---|---|
| Security | Custom auth with secure password hashing; RBAC at API and UI; HTTPS everywhere; input validation on all endpoints; protected secrets/environment variables |
| Performance | Dashboard and core list views should respond within a few seconds under normal 2-outlet load; Redis caching used for frequently accessed data |
| Scalability | Modular NestJS architecture allows scaling individual modules or adding outlets without redesign |
| Availability | Managed hosting (Railway/Supabase) targets high uptime; no formal SLA beyond provider guarantees at this budget tier |
| Responsive Design | Web application usable on desktop and mobile browsers, since staff will access it on phones on the floor |
| Maintainability | TypeScript across stack, modular structure, Prisma schema as single source of DB truth |
| Data Integrity | Foreign-key constraints, transactional writes for multi-step operations (e.g., purchase → inventory update) |
| Backup | Daily automated backups via Supabase, 7-day retention (plan-dependent) |
| Logging | Application logs retained per Supabase log retention window; AuditLog entity for business-action-level audit trail |
| Error Handling | Consistent API error format; user-facing error messages that do not leak internal details |
| API Security | Token-based auth, rate limiting on public-facing game APIs to mitigate abuse |
| Session Security | Secure, expiring tokens/sessions; no plaintext credential storage |
| Auditability | Key business actions (stock changes, leave decisions, reward issuance) recorded in AuditLog |

---

## 19. Third-Party Integrations

| Integration | Status | Notes |
|---|---|---|
| WhatsApp Business API | Confirmed / desired | Dependent on provider API availability, approval and usage pricing — treated separately from fixed infrastructure cost |
| Email / SMS | Conditional | Only where required and commercially approved by client |
| Google OAuth | Excluded | Explicitly not used per client instruction; custom authentication used instead |
| Hardware (printers, scanners, KDS, biometric, cash drawers) | Excluded from Phase 1 | Documented under Future Scope only (Section 24) |

---

## 20. Deployment & Infrastructure Cost

**Development Cost:** ₹45,000 (one-time). **Target Maintenance & Infrastructure:** under ₹5,000/month.

| Service | Plan Reference | Approx. Monthly Cost (USD) |
|---|---|---|
| Railway (Backend Hosting) | Hobby — $5/month minimum, includes $5 monthly usage credits | $5 |
| Supabase (Database/Storage/Backups) | Pro — 8 GB DB, 250 GB egress, 100 GB file storage, 7-day backups & logs | $25 |
| Upstash Redis | Fixed 250 MB plan, 50 GB bandwidth, unlimited commands | $10 |
| WhatsApp Business API | Provider/usage dependent | Variable — quoted separately |

> *Note: The above reflects current provider pricing at the time of writing and is not a permanent guarantee — third-party pricing and usage-based charges are subject to change by the respective providers.*

---

## 21. Delivery Timeline (3 Weeks)

| Week | Focus |
|---|---|
| Week 1 | Requirements finalization, architecture, database design, authentication, core UI foundation, inventory/purchase foundations |
| Week 2 | Inventory, purchasing, employees, tasks, checklists, notifications, core dashboards |
| Week 3 | Customer/game CRM, game configuration/publishing, rewards, integrations, testing, bug fixing, UAT, production deployment |

> *Exact sequencing within and across weeks may change during development based on technical dependencies discovered along the way.*

---

## 22. Testing & UAT

- Unit/integration testing of core backend modules (Inventory, Purchase, Employee, Task, Game, Notification)
- Functional testing of each FR against its Main Flow and Expected Result
- Role-based access testing across all defined roles
- UAT session with Bob's Momo management/staff in Week 3, using real Phase 1 workflows
- Bug fixing window built into Week 3 prior to production deployment

---

## 23. Assumptions & Constraints

### 23.1 Assumptions
- Client will provide timely feedback and content (item lists, vendor lists, employee lists, game rules) during Week 1
- No existing POS system/API is assumed for sales data unless confirmed by client
- 2 outlets at launch; architecture supports adding more outlets later without redesign
- Manual data entry is acceptable for Phase 1 given hardware integrations are excluded

### 23.2 Constraints
- 3-week total delivery timeline
- ₹45,000 one-time development budget; under ₹5,000/month target infrastructure cost
- No Google OAuth; custom authentication only
- No hardware integrations in Phase 1

---

## 24. Future Scope (Post Phase 1)

- Hardware integrations: thermal printers, barcode scanners, Kitchen Display System (KDS), customer displays, biometric attendance devices, cash drawers
- POS integration for automated sales data capture (if no existing POS API is confirmed for Phase 1)
- Payroll computation and payslip generation (if salary information storage only is chosen for Phase 1)
- Advanced fraud/abuse detection for the Game CRM
- Multi-outlet expansion beyond the initial 2 outlets
- Advanced analytics / BI layer beyond the Phase 1 dashboard

---

## 25. Out of Scope

- Any hardware procurement or hardware integration under this SRS
- Google OAuth or any social login
- Payment gateway integration (unless separately confirmed and scoped)
- Native mobile applications (Phase 1 is responsive web only)
- Multi-level approval chains beyond what is explicitly defined in each workflow

---

## 26. Requirements Traceability Matrix

| Client Requirement | Module | Functional Requirement(s) |
|---|---|---|
| Digitize paper-based inventory | Inventory | FR-INV-001, FR-INV-002, FR-INV-003 |
| Sales data via WhatsApp | Analytics / Reporting | Section 13 (Daily Sales Summary — TBC pending POS confirmation) |
| Duty roster via WhatsApp | Workforce | FR-EMP-002 |
| Kitchen open/close via WhatsApp | Tasks & Operations | FR-TASK-004 |
| Stock updates via WhatsApp | Inventory | FR-INV-001, FR-NOTIF-001 |
| Opening/Issued/Restocked/Closing tracking | Inventory | FR-INV-001 |
| Daily purchase pricing visibility | Purchase | FR-PUR-002, FR-PUR-003 |
| Visibility of who is working/on leave/on break | Workforce | FR-EMP-002 |
| Historical leave & salary management | Workforce | FR-EMP-004 |
| Task assignment & operational audits | Tasks & Operations | FR-TASK-001–FR-TASK-004 |
| Internal Chat, Alerts, Broadcast | Communication | FR-NOTIF-001, FR-NOTIF-002 |
| Customer games, scores, coins, rewards | Game CRM | FR-GAME-001, FR-GAME-002, FR-CRM-001, FR-CRM-002 |
| Dashboard for customer game/reward activity | Analytics | Section 13 |
| Business reporting (sales, inventory, performance, rewards, P&L, waste) | Analytics | Section 13 |

---

## 27. Acceptance Criteria

1. All Must-Have functional requirements in Section 15 are implemented and pass functional testing
2. RBAC correctly restricts each defined role to its intended modules/outlets
3. Inventory, purchase, employee, task, and game/reward workflows operate end-to-end without requiring unnecessary approval steps beyond those specified
4. Notifications fire correctly for each event listed in Section 14
5. System deployed to production on Railway/Supabase/Redis per Section 16.10, accessible to authorized users
6. UAT sign-off obtained from Bob's Momo management following Week 3 UAT session

---

## 28. Client & Agency Responsibilities

### 28.1 Bob's Momo (Client) Responsibilities
- Provide item, vendor, employee and outlet master data within Week 1
- Provide existing game rules/assets for the website game layer
- Confirm all TBC items listed in Section 29 promptly to avoid timeline slippage
- Participate in Week 3 UAT and provide sign-off
- Bear ongoing third-party usage costs (e.g., WhatsApp Business API usage) beyond fixed infrastructure

### 28.2 Wide Angle Media and Technologies Responsibilities
- Design, develop, test and deploy the Phase 1 scope defined in this SRS within the 3-week timeline
- Configure production infrastructure (Railway, Supabase, Upstash Redis)
- Conduct UAT session and address issues identified within agreed scope
- Deliver deployment and environment documentation

---

## 29. Open Questions (TBC / Client Confirmation Required)

Consolidated from all sections above. These must be resolved during Week 1 to avoid timeline impact.

1. Final field-level and action-level permission matrix per role/module (Section 5)
2. Whether basic stock transfer between the 2 outlets is required for Phase 1 (Section 7.2)
3. Low-stock threshold values per item (Section 7.2)
4. Whether salary computation/payroll processing is in scope, or storage only (Section 9)
5. Whether biometric/photo-based attendance is required — currently manual per hardware exclusion (Section 9)
6. Extent of fraud/abuse control sophistication achievable within 3 weeks (Section 12)
7. Guest vs identified-customer handling in the Customer CRM (Section 15.7 / FR-CRM-001)
8. Whether an existing POS system/API exists for sales data ingestion, or manual entry in Phase 1 (Section 13)
9. Full ER diagram / field-level schema finalization (Section 17)

---

## 30. Sign-Off

By signing below, both parties confirm agreement with the scope, requirements and terms defined in this Software Requirements Specification, including the Phase 1 scope boundaries, 3-week timeline, and the Scope Management statement in Section 3.1.

| | Bob's Momo (Client) | Wide Angle Media and Technologies |
|---|---|---|
| Name | | |
| Designation | | |
| Signature | | |
| Date | | |

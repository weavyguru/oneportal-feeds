# OnePortal — Weavy Permissions & Navigation Demo

A Node.js + Express demo app that explores three different strategies for
controlling who can read, write, and post in Weavy `wy-posts` feeds — plus
a notification-driven deeplink navigation pattern.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Weavy API Endpoints Used](#weavy-api-endpoints-used)
3. [Directories & Users](#directories--users)
4. [Permission Strategies](#permission-strategies)
   - [Strategy 1: Weavy-native access levels](#strategy-1-weavy-native-access-levels)
   - [Strategy 2: Weavy-native access + member overrides](#strategy-2-weavy-native-access--member-overrides)
   - [Strategy 3: App-side CSS hiding (comment-but-not-post)](#strategy-3-app-side-css-hiding-comment-but-not-post)
5. [Hiding Editors with CSS ::part()](#hiding-editors-with-csspart)
6. [Notification Navigation & Deeplinks](#notification-navigation--deeplinks)
7. [UID Naming Strategy for Deeplinks](#uid-naming-strategy-for-deeplinks)
8. [Permission Matrix](#permission-matrix)

---

## Architecture Overview

```
+--------------------------------------------------+
|  Browser (index.html)                            |
|                                                  |
|  +-----------+  +---------------------------+    |
|  | User      |  | wy-notification-badge     |    |
|  | Dropdown  |  | -> wy-notifications flyout |    |
|  +-----------+  +---------------------------+    |
|                                                  |
|  [Tab Bar]  dir-a-all | dir-a-user1 | dir-b-all  |
|  +----------------------------------------------+|
|  |  <wy-posts uid="posts-...">                  ||
|  |                                               ||
|  |  +------------------------------------------+||
|  |  | wy-post-editor  (can be hidden via CSS)  |||
|  |  +------------------------------------------+||
|  |  | Post 1 ...                                |||
|  |  |   wy-editor (comment — NOT hidden)        |||
|  |  | Post 2 ...                                |||
|  |  +------------------------------------------+||
|  +----------------------------------------------+|
+--------------------------------------------------+
         |                     |
         | /api/token          | /api/config
         | /api/switch-user    | /api/apps/:uid/permissions
         v                     v
+--------------------------------------------------+
|  Express Server (server.js)                      |
|                                                  |
|  - Upserts directories, users, apps on startup   |
|  - Proxies token requests to Weavy               |
|  - Fetches per-user permissions from Weavy API   |
|  - Serves SPA for /tab/:slug routes              |
+--------------------------------------------------+
         |
         | Weavy Web API (server-to-server)
         | Authorization: Bearer WEAVY_API_KEY
         v
+--------------------------------------------------+
|  Weavy Environment                               |
|  https://XXXX.weavy.io                           |
|                                                  |
|  Directories:  directory-a, directory-b           |
|  Users:        user-1 .. user-5                   |
|  Apps:         5x posts apps with varying access  |
+--------------------------------------------------+
```

---

## Weavy API Endpoints Used

Every call below is server-to-server using the API key, except where noted.
Base URL: `WEAVY_URL` from `.env`.

### Directories

| Method | Endpoint                    | Used in        | Purpose                         |
|--------|-----------------------------|----------------|---------------------------------|
| `GET`  | `/api/directories/{name}`   | `seed()`       | Check if directory exists       |
| `POST` | `/api/directories`          | `seed()`       | Create a new directory          |

**Docs:** https://www.weavy.com/docs/reference/api/directories

```bash
# Create a directory
curl -X POST {WEAVY_URL}/api/directories \
  -H "Authorization: Bearer {API_KEY}" \
  --json '{ "name": "directory-a" }'
```

### Users

| Method | Endpoint                          | Used in        | Purpose                              |
|--------|-----------------------------------|----------------|--------------------------------------|
| `PUT`  | `/api/users/{uid}`                | `seed()`       | Create or update a user              |
| `POST` | `/api/users/{uid}/tokens`         | `/api/token`   | Issue an access token for a user     |

**Docs:** https://www.weavy.com/docs/reference/api/users

```bash
# Upsert a user into a directory
curl -X PUT {WEAVY_URL}/api/users/user-1 \
  -H "Authorization: Bearer {API_KEY}" \
  --json '{
    "name": "User 1 (Directory A)",
    "email": "user1@test.local",
    "directory": "directory-a"
  }'

# Issue an access token for the user (used by tokenFactory on the client)
curl -X POST {WEAVY_URL}/api/users/user-1/tokens \
  -H "Authorization: Bearer {API_KEY}" \
  --json '{ "expires_in": 3600 }'
# -> { "access_token": "wyu_..." }
```

### Apps

| Method | Endpoint                              | Used in              | Purpose                                |
|--------|---------------------------------------|----------------------|----------------------------------------|
| `PUT`  | `/api/apps/{uid}`                     | `seed()`             | Create or update a posts app           |
| `GET`  | `/api/apps/{uid}`                     | `/api/apps/:uid/permissions` | Fetch app details + user permissions |
| `PUT`  | `/api/apps/{app}/members/{user}`      | `seed()`             | Add/update a member's access level     |

**Docs:** https://www.weavy.com/docs/reference/api/apps

```bash
# Upsert a posts app with directory scope and access level
curl -X PUT {WEAVY_URL}/api/apps/posts-directory-b-all \
  -H "Authorization: Bearer {API_KEY}" \
  --json '{
    "type": "posts",
    "name": "Directory B - all",
    "access": "write",
    "directory": "directory-b"
  }'

# Add a member with write access to a read-only app
curl -X PUT {WEAVY_URL}/api/apps/posts-directory-b-user4-5-write/members/user-4 \
  -H "Authorization: Bearer {API_KEY}" \
  --json '{ "access": "write" }'

# Fetch app as a specific user to check their permissions
# (uses the USER's access token, not the API key)
curl {WEAVY_URL}/api/apps/posts-directory-b-user4-5-write \
  -H "Authorization: Bearer {USER_ACCESS_TOKEN}"
# -> { ..., "permissions": ["read"] }           # read-only user
# -> { ..., "permissions": ["read", "create"] } # write user
```

The `permissions` array in the response is what the demo uses to determine
whether to show the "Hide editors" toggle. If it includes `"create"`, the
user has write access.

### Request flow

```
Browser                    Express Server               Weavy API
   |                            |                           |
   |  GET /api/config           |                           |
   |<---------------------------|                           |
   |  { apps, users, current }  |                           |
   |                            |                           |
   |  GET /api/token            |                           |
   |--------------------------->|                           |
   |                            |  POST /api/users/{uid}/tokens
   |                            |-------------------------->|
   |                            |  { access_token }         |
   |                            |<--------------------------|
   |  { access_token }          |                           |
   |<---------------------------|                           |
   |                            |                           |
   |  GET /api/apps/{uid}/      |                           |
   |      permissions           |                           |
   |--------------------------->|                           |
   |                            |  POST /api/users/{uid}/tokens
   |                            |-------------------------->|
   |                            |  { access_token }         |
   |                            |<--------------------------|
   |                            |  GET /api/apps/{uid}      |
   |                            |  (as user, with token)    |
   |                            |-------------------------->|
   |                            |  { permissions: [...] }   |
   |                            |<--------------------------|
   |  { permissions }           |                           |
   |<---------------------------|                           |
```

---

## Directories & Users

Directories are Weavy's grouping mechanism. A user belongs to one directory
and can only access apps scoped to that directory.

```
directory-a                    directory-b
+-----------+-----------+      +-----------+-----------+-----------+
|  User 1   |  User 2   |      |  User 3   |  User 4   |  User 5   |
+-----------+-----------+      +-----------+-----------+-----------+
```

Users are upserted on server startup via
[`PUT /api/users/{uid}`](https://www.weavy.com/docs/reference/api/users)
with a `directory` field that associates them. Directories are created via
[`POST /api/directories`](https://www.weavy.com/docs/reference/api/directories).

---

## Permission Strategies

This demo implements three distinct approaches to permission control.
Each solves a different real-world scenario.

### Strategy 1: Weavy-native access levels

**Tabs:** "Directory A - all", "Directory B - all"

```
App: posts-directory-a-all
access: "write"
directory: "directory-a"
```

The simplest model. Weavy handles everything:

```
                      Can see app?    Can post?    Can comment?
                      ------------- ------------ --------------
User 1 (Dir A)           yes            yes           yes
User 2 (Dir A)           yes            yes           yes
User 3 (Dir B)           no             no            no
User 4 (Dir B)           no             no            no
```

- `directory` scopes visibility — only users in that directory see the app
- `access: "write"` means everyone who CAN see it can also create content
- `access: "read"` means everyone who CAN see it can only read (not post)

### Strategy 2: Weavy-native access + member overrides

**Tab:** "Directory A - User 1 can write", "Directory B - User 4+5 writes"

```
App: posts-directory-b-user4-5-write
access: "read"                          <-- default for directory members
directory: "directory-b"
members:
  user-4: access = "write"              <-- override via PUT /api/apps/{app}/members/{user}
  user-5: access = "write"              <-- override
```

The app is upserted via [`PUT /api/apps/{uid}`](https://www.weavy.com/docs/reference/api/apps)
with `access: "read"`. Then specific users are added as members with `write`
via [`PUT /api/apps/{app}/members/{user}`](https://www.weavy.com/docs/reference/api/apps).
Weavy enforces this server-side — the UI automatically shows or hides the editor.

```
                      Can see app?    Can post?    Can comment?
                      ------------- ------------ --------------
User 3 (Dir B)           yes            NO            NO
User 4 (Dir B)           yes            yes           yes
User 5 (Dir B)           yes            yes           yes
```

A UI toggle is shown for read-only users. The Express server fetches a
short-lived token via [`POST /api/users/{uid}/tokens`](https://www.weavy.com/docs/reference/api/users),
then calls [`GET /api/apps/{uid}`](https://www.weavy.com/docs/reference/api/apps) **as that user**.
The response `permissions` array is checked for `"create"`. If absent, the
user is read-only and a checkbox toggle is offered to hide editors via CSS.

### Strategy 3: App-side CSS hiding (comment-but-not-post)

**Tab:** "Alt Directory B - User 4+5 writes"

This is the most nuanced pattern. It solves:

> "I want User 3 to be able to COMMENT on posts but NOT create new posts."

Weavy's permission model is binary — `read` blocks both posting AND
commenting, `write` allows both. There is no native "can comment but
not post" level.

**The workaround: give everyone `write`, then hide the post editor via CSS.**

```
App: posts-alt-directory-b-user4-5-write
access: "write"                          <-- everyone in Dir B can write
directory: "directory-b"
hideEditorExcept: ["user-4", "user-5"]   <-- app-side config (NOT sent to Weavy)
```

On the client, for users NOT in `hideEditorExcept`:

```css
wy-posts[uid="posts-alt-directory-b-user4-5-write"]::part(wy-post-editor) {
  display: none;
}
```

This hides ONLY the top-level post creation editor. Comment editors on
existing posts remain visible because they use a different CSS part.

```
+--------------------------------------------+
|  wy-posts                                  |
|                                            |
|  +----------------------------------------+|    <-- HIDDEN for User 3
|  | wy-post-editor  "Create a post..."     ||        via ::part(wy-post-editor)
|  +----------------------------------------+|
|                                            |
|  +----------------------------------------+|
|  | Post by User 4                         ||
|  |   "Hello everyone"                     ||
|  |                                        ||
|  |   [Comment]  <-- wy-editor             ||    <-- VISIBLE for User 3
|  |   This is a comment editor, NOT the    ||        (different CSS part)
|  |   post editor, so it remains shown     ||
|  +----------------------------------------+|
+--------------------------------------------+
```

The result:

```
                      Can see app?    Can post?    Can comment?
                      ------------- ------------ --------------
User 3 (Dir B)           yes           NO (*)         yes
User 4 (Dir B)           yes            yes           yes
User 5 (Dir B)           yes            yes           yes

(*) Hidden via CSS. Weavy still grants write — this is a UI-only restriction.
```

**Important:** This is NOT a security boundary. User 3 technically has
`write` at the API level. A determined user could bypass the CSS and post
via the API. This pattern is suitable for UX-level guidance, not for
enforcing hard security. For hard enforcement, use Strategy 2.

---

## Hiding Editors with CSS ::part()

Weavy web components use Shadow DOM but export CSS parts via `exportparts`.
This lets the host app style internal elements.

### Key CSS parts for wy-posts

| Part                | What it targets                          |
|---------------------|------------------------------------------|
| `wy-editor`         | ALL editors (post creation + comments)   |
| `wy-post-editor`    | ONLY the top-level post creation editor  |

### Targeting a specific app instance

```css
/* Hide post editor on one specific feed */
wy-posts[uid="my-app"]::part(wy-post-editor) {
  display: none;
}

/* Hide ALL editors (post + comment) on one feed */
wy-posts[uid="my-app"]::part(wy-editor) {
  display: none;
}
```

### Two implementation patterns in this demo

**Pattern A — Always hidden (`hideEditorExcept`)**

Server sends a list of users who SHOULD see the editor. Client injects a
`<style>` rule at page load for everyone else. No toggle, no user control.

**Pattern B — Toggle-controlled (`editorToggle`)**

Server marks the app with `editorToggle: true`. Client fetches the user's
permissions from `GET /api/apps/{uid}/permissions` (which calls the Weavy
API as that user). If `permissions` doesn't include `"create"`, a checkbox
toggle is rendered. The user can show/hide editors at will.

```
[ ] Hide editors (read-only access)      <-- unchecked by default
```

---

## Notification Navigation & Deeplinks

### How it works

```
+-------------------+        wy-link event         +------------------+
| wy-notifications  | ---------------------------> | Event listener   |
| (flyout panel)    |   e.detail.link.app.uid      | on document      |
+-------------------+   = "posts-directory-a-all"  +------------------+
                                                           |
                                                   Lookup uid -> slug
                                                   in config.apps
                                                           |
                                                           v
                                                   history.pushState
                                                   /tab/dir-a-all
                                                           |
                                                           v
                                                   activateTab("dir-a-all")
                                                   + closeFlyout()
```

When a user clicks a notification in `<wy-notifications>`, Weavy fires a
`wy-link` CustomEvent on the document. The event detail includes:

```javascript
e.detail = {
  link: {
    id: 123,              // entity id (post, comment, etc.)
    type: "comment",      // entity type
    app: {
      id: 42,
      type: "5ebfa152-...",
      uid: "posts-directory-a-all"    // <-- THIS is what we use
    }
  }
}
```

The client looks up `e.detail.link.app.uid` in the apps config to find the
matching slug, then navigates via `history.pushState("/tab/{slug}")`.

### Deeplink routing

Tabs use real URL paths, not hash fragments:

```
http://localhost:3001/tab/dir-a-all
http://localhost:3001/tab/dir-b-user4-5-write
http://localhost:3001/tab/alt-dir-b-user4-5-write
```

Express serves `index.html` for all `/tab/:slug` routes (SPA fallback).
The client reads `window.location.pathname` on load to activate the
correct tab.

---

## UID Naming Strategy for Deeplinks

In this demo, the UID-to-slug mapping is a simple lookup table. In a
real application with hundreds of apps, you should encode the navigation
path INTO the UID itself so you can reconstruct the deeplink without
a lookup table.

### The problem

Imagine a large app where feeds are buried deep in a hierarchy:

```
/projects/acme/tasks/sprint-3/feed
/clients/globex/onboarding/feed
/teams/engineering/announcements
```

When a `wy-link` event fires, you get `e.detail.link.app.uid`. If the
UID is just `"feed-123"`, you have no idea where to navigate.

### The solution: encode the route in the UID

Use a delimiter (e.g. `--`) to encode the navigation path:

```
UID: "posts--projects--acme--tasks--sprint-3--feed"
                |        |      |       |       |
                v        v      v       v       v
Route:     /projects / acme / tasks / sprint-3 / feed
```

### UID parsing on notification click

```javascript
document.addEventListener("wy-link", (e) => {
  const uid = e.detail?.link?.app?.uid;
  if (!uid) return;

  // Convention: UIDs use "--" as path separator
  // Strip the "posts--" type prefix, rebuild the route
  const parts = uid.split("--");
  const type = parts[0];           // "posts", "chat", "files", etc.
  const route = parts.slice(1);    // ["projects", "acme", "tasks", ...]

  const deeplink = "/" + route.join("/");
  // -> "/projects/acme/tasks/sprint-3/feed"

  history.pushState(null, "", deeplink);
  navigateTo(deeplink);
});
```

### Naming conventions

```
Pattern:  {type}--{path-segment-1}--{path-segment-2}--...

Examples:
  posts--projects--acme--tasks--sprint3--feed
  chat--teams--engineering--general
  files--clients--globex--contracts
  posts--dir-a--announcements
```

Rules:
- **Prefix with app type** (`posts`, `chat`, `files`) for filtering
- **Use `--` as delimiter** (double dash) — safe in UIDs, visually distinct
- **Mirror your route hierarchy** so the UID IS the deeplink, reversed
- **Keep segments URL-safe** — lowercase, hyphens, no special chars
- **Weavy UID max length:** UIDs are strings; keep them reasonable (<128 chars)

### Why not just store a URL in metadata?

You could use the app's `metadata` field to store a navigation URL:

```javascript
// When creating the app
{ metadata: { route: "/projects/acme/tasks/sprint-3/feed" } }
```

But this requires an extra API call to fetch the app's metadata on every
notification click. Encoding the route in the UID makes navigation instant
with zero API calls — everything you need is in the `wy-link` event payload.

---

## Permission Matrix

Full matrix of what each user can do in each tab:

```
+-------+------------------+------------------+------------------+------------------+---------------------+
| User  | Dir A - all      | Dir A - User 1   | Dir B - all      | Dir B - User 4+5 | Alt Dir B - User    |
|       |                  | can write        |                  | writes           | 4+5 writes          |
+-------+------------------+------------------+------------------+------------------+---------------------+
|       | access=write     | access=read      | access=write     | access=read      | access=write        |
|       | dir=A            | dir=A            | dir=B            | dir=B            | dir=B               |
|       |                  | member: U1=write |                  | member: U4=write | hideEditor except   |
|       |                  |                  |                  | member: U5=write | U4, U5              |
+-------+------------------+------------------+------------------+------------------+---------------------+
| U1(A) | see/post/comment | see/post/comment |     blocked      |     blocked      |      blocked        |
| U2(A) | see/post/comment | see only         |     blocked      |     blocked      |      blocked        |
| U3(B) |     blocked      |     blocked      | see/post/comment | see only         | see/COMMENT only(*) |
| U4(B) |     blocked      |     blocked      | see/post/comment | see/post/comment | see/post/comment    |
| U5(B) |     blocked      |     blocked      | see/post/comment | see/post/comment | see/post/comment    |
+-------+------------------+------------------+------------------+------------------+---------------------+

blocked   = user's directory doesn't match; app not visible at all
see only  = can read posts but cannot create posts or comments (Weavy-enforced)
COMMENT(*)= can comment on existing posts but post editor is hidden via CSS
            (Weavy grants write; UI restricts posting — NOT a security boundary)
```

---

## Running the Demo

```bash
# 1. Copy the example env and fill in your Weavy credentials
cp .env.example .env

# 2. Install dependencies
npm install

# 3. Start with auto-reload
npm run dev
```

Open http://localhost:3001 and use the user dropdown to switch between
users. Observe how each tab's editor visibility changes based on the
active user and the permission strategy in use.

On first startup, the server seeds all directories, users, and apps into
your Weavy environment via the API. Subsequent restarts are idempotent
(upserts).

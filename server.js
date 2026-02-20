import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(cookieParser());
app.use(express.static(join(__dirname, "public")));

// --- Directories & Users ---

const DIRECTORIES = ["directory-a", "directory-b"];

const USERS = [
  { uid: "user-1", name: "User 1 (Directory A)", email: "user1@test.local", directory: "directory-a" },
  { uid: "user-2", name: "User 2 (Directory A)", email: "user2@test.local", directory: "directory-a" },
  { uid: "user-3", name: "User 3 (Directory B)", email: "user3@test.local", directory: "directory-b" },
  { uid: "user-4", name: "User 4 (Directory B)", email: "user4@test.local", directory: "directory-b" },
  { uid: "user-5", name: "User 5 (Directory B)", email: "user5@test.local", directory: "directory-b" },
];

const WEAVY_URL = process.env.WEAVY_URL;
const WEAVY_API_KEY = process.env.WEAVY_API_KEY;

function weavyFetch(path, options = {}) {
  return fetch(new URL(path, WEAVY_URL), {
    ...options,
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${WEAVY_API_KEY}`,
      ...options.headers,
    },
  });
}

async function ensureDirectory(name) {
  // Try to get it first; create if 404
  const res = await weavyFetch(`/api/directories/${name}`);
  if (res.ok) {
    console.log(`Directory "${name}" already exists.`);
    return;
  }
  const createRes = await weavyFetch("/api/directories", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  if (!createRes.ok) {
    const text = await createRes.text();
    throw new Error(`Failed to create directory "${name}": ${createRes.status} ${text}`);
  }
  console.log(`Directory "${name}" created.`);
}

async function upsertUser(user) {
  const { uid, ...data } = user;
  console.log(`Upserting user "${uid}" into directory "${data.directory}"...`);
  const res = await weavyFetch(`/api/users/${uid}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to upsert user "${uid}": ${res.status} ${text}`);
  }
}

// --- Apps (Posts) ---

const APPS = [
  {
    uid: "posts-directory-a-all",
    slug: "dir-a-all",
    type: "posts",
    name: "Directory A - all",
    access: "write",
    directory: "directory-a",
  },
  {
    uid: "posts-directory-a-user1-write",
    slug: "dir-a-user1-write",
    type: "posts",
    name: "Directory A - User 1 can write",
    access: "read",
    directory: "directory-a",
  },
  {
    uid: "posts-directory-b-all",
    slug: "dir-b-all",
    type: "posts",
    name: "Directory B - all",
    access: "write",
    directory: "directory-b",
  },
  {
    uid: "posts-directory-b-user4-5-write",
    slug: "dir-b-user4-5-write",
    type: "posts",
    name: "Directory B - User 4+5 writes",
    access: "read",
    directory: "directory-b",
    editorToggle: true,
  },
  {
    uid: "posts-alt-directory-b-user4-5-write",
    slug: "alt-dir-b-user4-5-write",
    type: "posts",
    name: "Alt Directory B - User 4+5 writes",
    access: "write",
    directory: "directory-b",
    hideEditorExcept: ["user-4", "user-5"],
  },
];

async function upsertApp(appDef) {
  const { uid, slug, hideEditorExcept, editorToggle, ...data } = appDef;
  console.log(`Upserting app "${uid}"...`);
  const res = await weavyFetch(`/api/apps/${uid}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to upsert app "${uid}": ${res.status} ${text}`);
  }
  console.log(`App "${uid}" upserted.`);
}

async function upsertAppMember(appUid, userUid, access) {
  console.log(`Setting member "${userUid}" on app "${appUid}" with access="${access}"...`);
  const res = await weavyFetch(`/api/apps/${appUid}/members/${userUid}`, {
    method: "PUT",
    body: JSON.stringify({ access }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to upsert member: ${res.status} ${text}`);
  }
}

function getCurrentUser(req) {
  const uid = req.cookies?.weavy_user || USERS[0].uid;
  return USERS.find((u) => u.uid === uid) || USERS[0];
}

// --- Routes ---

app.get("/api/config", (req, res) => {
  const current = getCurrentUser(req);
  res.json({
    weavyUrl: WEAVY_URL,
    users: USERS.map((u) => ({ uid: u.uid, name: u.name })),
    currentUser: current.uid,
    apps: APPS.map((a) => ({
      uid: a.uid,
      slug: a.slug,
      name: a.name,
      hideEditorExcept: a.hideEditorExcept,
      editorToggle: a.editorToggle,
    })),
  });
});

app.post("/api/switch-user", (req, res) => {
  const { uid } = req.body;
  if (!USERS.find((u) => u.uid === uid)) {
    return res.status(400).json({ error: "Unknown user" });
  }
  res.cookie("weavy_user", uid, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
  res.json({ ok: true });
});

app.get("/api/token", async (req, res) => {
  const user = getCurrentUser(req);
  try {
    const response = await weavyFetch(`/api/users/${user.uid}/tokens`, {
      method: "POST",
      body: JSON.stringify({ expires_in: 3600 }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Token request failed: ${response.status} ${text}`);
    }
    const data = await response.json();
    res.json({ access_token: data.access_token });
  } catch (err) {
    console.error("Token error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get user's permissions on an app via Weavy API using their token
app.get("/api/apps/:uid/permissions", async (req, res) => {
  const user = getCurrentUser(req);
  try {
    // Get a token for the current user
    const tokenRes = await weavyFetch(`/api/users/${user.uid}/tokens`, {
      method: "POST",
      body: JSON.stringify({ expires_in: 60 }),
    });
    if (!tokenRes.ok) throw new Error("Could not get user token");
    const { access_token } = await tokenRes.json();

    // Fetch app as the user to get their permissions
    const appRes = await fetch(new URL(`/api/apps/${req.params.uid}`, WEAVY_URL), {
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${access_token}`,
      },
    });
    if (!appRes.ok) {
      return res.json({ permissions: [] });
    }
    const appData = await appRes.json();
    res.json({ permissions: appData.permissions || [] });
  } catch (err) {
    console.error("Permissions error:", err.message);
    res.json({ permissions: [] });
  }
});

// SPA fallback: serve index.html for /tab/* and root
app.get(["/", "/tab/:slug"], (req, res) => {
  res.sendFile(join(__dirname, "public", "index.html"));
});

// --- Startup ---

async function seed() {
  if (!WEAVY_URL || !WEAVY_API_KEY) {
    throw new Error("WEAVY_URL and WEAVY_API_KEY must be set in .env");
  }

  // Create directories
  for (const dir of DIRECTORIES) {
    await ensureDirectory(dir);
  }

  // Upsert users
  for (const user of USERS) {
    await upsertUser(user);
  }

  // Upsert apps
  for (const appDef of APPS) {
    await upsertApp(appDef);
  }

  // Add User 1 as a write-member on the Directory A restricted app
  await upsertAppMember("posts-directory-a-user1-write", "user-1", "write");

  // Add User 4 and 5 as write-members on the Directory B restricted app
  await upsertAppMember("posts-directory-b-user4-5-write", "user-4", "write");
  await upsertAppMember("posts-directory-b-user4-5-write", "user-5", "write");
}

seed()
  .then(() => {
    console.log("All directories and users synced.");
    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Startup failed:", err.message);
    process.exit(1);
  });

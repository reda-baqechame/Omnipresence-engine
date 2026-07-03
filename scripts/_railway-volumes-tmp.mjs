import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
const token = JSON.parse(readFileSync(join(homedir(), ".railway", "config.json"), "utf8")).user?.accessToken;
const q = `{ project(id: "a59cacd1-25d3-404e-996b-4c61cc47f038") { volumes { edges { node { id name projectId } } } } }`;
const r = await fetch("https://backboard.railway.com/graphql/v2", {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: q }),
});
console.log(JSON.stringify(await r.json(), null, 2));

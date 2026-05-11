import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import express, { type Express } from "express"

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

export function resolveBuiltClientDir(root = projectRoot) {
  return path.join(root, "dist", "client")
}

export function hasBuiltClient(buildDir = resolveBuiltClientDir()) {
  return fs.existsSync(path.join(buildDir, "index.html"))
}

export function mountPublicBuiltClient(app: Express, buildDir = resolveBuiltClientDir()) {
  const indexPath = path.join(buildDir, "index.html")
  if (!fs.existsSync(indexPath)) {
    return false
  }

  app.use(express.static(buildDir, { index: false }))
  app.get("/", (_req, res) => {
    res.sendFile(indexPath)
  })

  return true
}

// `ytm-dl sync`: bring the Opus library up to date, then mirror it to the R2 bucket.
// R2 keys are read from 1Password by `op run`; nothing is stored on disk.
import { existsSync, readdirSync } from "node:fs"
import { OPUS_DIR } from "./download"
import { buildOpus } from "./opus"

const BUCKET = "music"
const ITEM = "op://API Keys/Cloudflare R2 music"

export async function sync(): Promise<number> {
  const missing = await buildOpus(OPUS_DIR)
  // Mirroring an empty folder would delete everything in the bucket.
  if (!existsSync(OPUS_DIR) || readdirSync(OPUS_DIR).length === 0) {
    console.log(`Opus library ${OPUS_DIR} is empty; not syncing.`)
    return 1
  }
  if (missing) console.log(`\nSyncing anyway; the ${missing} missing songs go up on a later sync.`)
  console.log(`\nMirroring ${OPUS_DIR} → R2 bucket "${BUCKET}"`)
  const proc = Bun.spawn(
    ["op", "run", "--", "rclone", "sync", OPUS_DIR, `r2:${BUCKET}`, "--exclude", ".DS_Store", "--stats-one-line", "-P"],
    {
      stdio: ["inherit", "inherit", "inherit"],
      env: {
        ...process.env,
        RCLONE_CONFIG_R2_TYPE: "s3",
        RCLONE_CONFIG_R2_PROVIDER: "Cloudflare",
        RCLONE_CONFIG_R2_ACCESS_KEY_ID: `${ITEM}/access_key_id`,
        RCLONE_CONFIG_R2_SECRET_ACCESS_KEY: `${ITEM}/secret_access_key`,
        RCLONE_CONFIG_R2_ENDPOINT: `${ITEM}/endpoint`,
        // Bucket-scoped R2 tokens can't list buckets, so don't check that the bucket exists.
        RCLONE_CONFIG_R2_NO_CHECK_BUCKET: "true",
      },
    },
  )
  return (await proc.exited) || (missing ? 1 : 0)
}

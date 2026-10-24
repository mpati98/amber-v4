// Kiểm thử tích hợp API nhạc trên Neon DEV + Vercel Blob (npm run dev phải chạy ở :3000).
// Tạo user tạm, tải hai blob thử nghiệm, kiểm tra upload token/CRUD/cô lập user, rồi dọn blob và user.
// Từ chối chạy nếu DATABASE_URL trùng host production. Không in token/URL.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { del, head } from "@vercel/blob";
import { getPayloadFromClientToken, upload } from "@vercel/blob/client";
import { eq } from "drizzle-orm";
import { SignJWT } from "jose";
import { db } from "@/db";
import { musicTracks, users } from "@/db/schema";
import { signAccessToken } from "@/lib/mobile-auth";

const host = (u?: string) => {
  try {
    return new URL(u ?? "").hostname;
  } catch {
    return "";
  }
};
if (!process.env.DATABASE_URL || !host(process.env.DATABASE_URL) || host(process.env.DATABASE_URL) === host(process.env.DATABASE_URL_PRODUCTION)) {
  console.error("Từ chối chạy: DATABASE_URL không phải nhánh dev (trùng host production hoặc chưa đặt).");
  process.exit(3);
}

const BASE = "http://localhost:3000/api/music";
const MAX_FILE_BYTES = 50 * 1024 * 1024;
let fails = 0;
const check = (name: string, ok: boolean, extra?: unknown) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` ${JSON.stringify(extra)}`}`);
};
type Json = Record<string, unknown>;
const asObject = (value: unknown): Json | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : null;
const call = async (token: string | null, method: string, path: string, body?: unknown) => {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text) as unknown;
  } catch {}
  return { status: response.status, json };
};

async function main() {
  const createdUsers: { id: string }[] = [];
  const uploadedBlobUrls: string[] = [];
  const makeUser = async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `music-e2e-${randomUUID()}@example.invalid`, passwordHash: "x" })
      .returning({ id: users.id });
    createdUsers.push(user);
    return user;
  };

  const userA = await makeUser();
  const userB = await makeUser();
  try {
    const tokenA = await signAccessToken(userA.id);
    const tokenB = await signAccessToken(userB.id);
    check("GET không token trả 401", (await call(null, "GET", "/tracks")).status === 401);
    check("POST upload không token trả 401", (await call(null, "POST", "/upload", {})).status === 401);

    const generated = await call(tokenA, "POST", "/upload", {
      type: "blob.generate-client-token",
      payload: {
        pathname: `music/${userA.id}/token-check.mp3`,
        multipart: false,
        clientPayload: null,
      },
    });
    const clientTokenValue = asObject(generated.json)?.clientToken;
    const clientToken = typeof clientTokenValue === "string" ? clientTokenValue : undefined;
    const constraints = clientToken ? getPayloadFromClientToken(clientToken) : null;
    check(
      "upload token chỉ cho audio/mpeg, giới hạn 50 MB",
      generated.status === 200 &&
        constraints?.allowedContentTypes?.length === 1 &&
        constraints.allowedContentTypes[0] === "audio/mpeg" &&
        constraints.maximumSizeInBytes === MAX_FILE_BYTES,
      generated.status,
    );
    check(
      "chặn pathname ngoài vùng user hoặc không phải mp3",
      (await call(tokenA, "POST", "/upload", {
        type: "blob.generate-client-token",
        payload: { pathname: `music/${userB.id}/not-mine.mp3`, multipart: false, clientPayload: null },
      })).status === 400 &&
        (await call(tokenA, "POST", "/upload", {
          type: "blob.generate-client-token",
          payload: { pathname: `music/${userA.id}/bad.wav`, multipart: false, clientPayload: null },
        })).status === 400,
    );

    const testAudio = Buffer.from("ID3\u0004\u0000\u0000");
    const uploadTestBlob = async (fileName: string) => {
      const blob = await upload(`music/${userA.id}/${fileName}`, testAudio, {
        access: "private",
        contentType: "audio/mpeg",
        handleUploadUrl: `${BASE}/upload`,
        headers: { Authorization: `Bearer ${tokenA}` },
      });
      uploadedBlobUrls.push(blob.url);
      return blob;
    };
    const blob1 = await uploadTestBlob("first.mp3");
    const blob2 = await uploadTestBlob("second.mp3");

    const first = await call(tokenA, "POST", "/tracks", {
      title: "Bài thứ nhất",
      artist: "Nghệ sĩ thử",
      blobUrl: blob1.url,
      blobPathname: blob1.pathname,
      durationSeconds: 123,
      sizeBytes: testAudio.length,
    });
    const second = await call(tokenA, "POST", "/tracks", {
      title: "Bài thứ hai",
      artist: null,
      blobUrl: blob2.url,
      blobPathname: blob2.pathname,
      durationSeconds: null,
      sizeBytes: testAudio.length,
    });
    const firstData = asObject(first.json);
    const secondData = asObject(second.json);
    const firstId = typeof firstData?.id === "string" ? firstData.id : "missing";
    const secondId = typeof secondData?.id === "string" ? secondData.id : "missing";
    check("POST tạo track trả 201 và position tăng dần", first.status === 201 && second.status === 201 && firstData?.position === 0 && secondData?.position === 1, [first.status, second.status]);
    const ownTracks = await call(tokenA, "GET", "/tracks");
    const ownTrackList = Array.isArray(ownTracks.json) ? ownTracks.json.map(asObject) : [];
    const firstStreamUrl = ownTrackList.find((track) => track?.id === firstId)?.streamUrl;
    const streamUrl = typeof firstStreamUrl === "string" ? new URL(firstStreamUrl) : null;
    const rangeResponse = streamUrl
      ? await fetch(streamUrl, { headers: { Range: "bytes=0-2" } })
      : null;
    const rangeBody = rangeResponse ? Buffer.from(await rangeResponse.arrayBuffer()) : Buffer.alloc(0);
    check(
      "GET /tracks trả streamUrl; Range trả 206 và đúng byte",
      rangeResponse?.status === 206 &&
        rangeResponse.headers.get("accept-ranges") === "bytes" &&
        rangeResponse.headers.get("content-range") === `bytes 0-2/${testAudio.length}` &&
        rangeResponse.headers.get("content-length") === "3" &&
        rangeBody.equals(testAudio.subarray(0, 3)),
      rangeResponse?.status,
    );
    const invalidRangeResponse = streamUrl
      ? await fetch(streamUrl, { headers: { Range: `bytes=${testAudio.length + 1}-` } })
      : null;
    check(
      "Range ngoài kích thước trả 416",
      invalidRangeResponse?.status === 416 &&
        invalidRangeResponse.headers.get("content-range") === `bytes */${testAudio.length}`,
      invalidRangeResponse?.status,
    );
    const invalidTokenResponse = streamUrl
      ? await fetch(new URL(`${streamUrl.pathname}?token=invalid`, BASE))
      : null;
    check("stream từ chối token không hợp lệ", invalidTokenResponse?.status === 401, invalidTokenResponse?.status);
    const now = Math.floor(Date.now() / 1000);
    const expiredToken = await new SignJWT({ trackId: firstId, purpose: "music-stream" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("amber-v4")
      .setAudience("music-stream")
      .setSubject(userA.id)
      .setIssuedAt(now - 60)
      .setExpirationTime(now - 1)
      .sign(new TextEncoder().encode(process.env.MOBILE_JWT_SECRET!));
    const expiredTokenResponse = streamUrl
      ? await fetch(new URL(`${streamUrl.pathname}?token=${encodeURIComponent(expiredToken)}`, BASE))
      : null;
    check("stream từ chối token hết hạn", expiredTokenResponse?.status === 401, expiredTokenResponse?.status);
    const otherTracks = await call(tokenB, "GET", "/tracks");
    check("GET chỉ liệt kê track của user theo position", Array.isArray(otherTracks.json) && otherTracks.json.length === 0);
    check("user khác không sửa/xóa được track (404)", (await call(tokenB, "PATCH", `/tracks/${firstId}`, { title: "Không được" })).status === 404 &&
      (await call(tokenB, "DELETE", `/tracks/${firstId}`)).status === 404);
    check("PATCH từ chối body rỗng và title trống", (await call(tokenA, "PATCH", `/tracks/${firstId}`, {})).status === 400 &&
      (await call(tokenA, "PATCH", `/tracks/${firstId}`, { title: " " })).status === 400);

    const moved = await call(tokenA, "PATCH", `/tracks/${secondId}`, { title: "Đổi tên", artist: "Ca sĩ", position: 0 });
    const ordered = await call(tokenA, "GET", "/tracks");
    const movedData = asObject(moved.json);
    const orderedTracks = Array.isArray(ordered.json) ? ordered.json.map(asObject) : [];
    check("PATCH cập nhật metadata và đổi thứ tự", moved.status === 200 && movedData?.title === "Đổi tên" &&
      movedData?.artist === "Ca sĩ" && movedData?.position === 0 &&
      orderedTracks[0]?.id === secondId && orderedTracks[1]?.id === firstId, ordered.json);

    const removed = await call(tokenA, "DELETE", `/tracks/${firstId}`);
    const removedData = asObject(removed.json);
    const left = await db.select().from(musicTracks).where(eq(musicTracks.userId, userA.id));
    check("DELETE trả {ok:true} và xóa row", removed.status === 200 && removedData?.ok === true && left.length === 1);
    uploadedBlobUrls.splice(uploadedBlobUrls.indexOf(blob1.url), 1);
    let blobDeleted = false;
    try {
      await head(blob1.url);
    } catch {
      blobDeleted = true;
    }
    check("DELETE xóa Blob", blobDeleted);

    const removedLast = await call(tokenA, "DELETE", `/tracks/${secondId}`);
    check("DELETE track cuối", asObject(removedLast.json)?.ok === true);
    uploadedBlobUrls.splice(uploadedBlobUrls.indexOf(blob2.url), 1);
  } finally {
    for (const url of uploadedBlobUrls) {
      try {
        await del(url);
      } catch (error) {
        console.error("Dọn Blob thử nghiệm thất bại:", error instanceof Error ? error.message : "unknown error");
        fails++;
      }
    }
    for (const user of createdUsers) {
      await db.delete(users).where(eq(users.id, user.id));
    }
  }

  console.log(`\n${fails === 0 ? "PASS" : "FAIL"} ${fails} lỗi`);
  process.exitCode = fails === 0 ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

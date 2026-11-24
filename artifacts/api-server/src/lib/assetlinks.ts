export type AssetLink = {
  relation: string[];
  target: { namespace: "android_app"; package_name: string; sha256_cert_fingerprints: string[] };
};

/** Digital Asset Links statement for the Android app (Trusted Web Activity), or null when not configured. */
export function assetLinks(env: Record<string, string | undefined> = process.env): AssetLink[] | null {
  const packageName = env.ANDROID_PACKAGE_NAME?.trim();
  const fingerprints = (env.ANDROID_CERT_SHA256 ?? "")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  if (!packageName || fingerprints.length === 0) return null;
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: packageName, sha256_cert_fingerprints: fingerprints },
    },
  ];
}

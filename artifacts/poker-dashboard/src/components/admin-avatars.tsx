import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, LoaderCircle, Pencil, Trash2 } from "lucide-react";
import { AvatarArt, AVATAR_PRESETS } from "@/components/avatar-art";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { shrinkImageToDataUrl } from "@/lib/avatars";

type AdminAvatar = {
  key: string;
  name: string;
  kind: "preset" | "upload";
  preset: string | null;
  version: number;
  updatedAt: string;
};

type AdminMember = { name: string };
type AvatarInput = { kind: "preset"; preset: string } | { kind: "upload"; imageDataUrl: string };

const memberKey = (name: string) => name.trim().replace(/\s+/g, " ").toLocaleLowerCase();

async function responseError(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error || fallback;
  } catch {
    return fallback;
  }
}

/** Lets an admin see and change each configured member's profile picture. */
export function AdminAvatarsPanel() {
  const [members, setMembers] = useState<AdminMember[] | null>(null);
  const [avatars, setAvatars] = useState<AdminAvatar[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [dialogError, setDialogError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [membersResponse, avatarsResponse] = await Promise.all([
        fetch("/api/admin/members", { credentials: "include" }),
        fetch("/api/admin/avatars", { credentials: "include" }),
      ]);
      if (!membersResponse.ok) throw new Error(await responseError(membersResponse, "Could not load members."));
      if (!avatarsResponse.ok) throw new Error(await responseError(avatarsResponse, "Could not load profile pictures."));
      const [memberBody, avatarBody] = await Promise.all([
        membersResponse.json() as Promise<{ members: AdminMember[] }>,
        avatarsResponse.json() as Promise<{ avatars: AdminAvatar[] }>,
      ]);
      setMembers(memberBody.members);
      setAvatars(avatarBody.avatars);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load profile pictures.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const avatarByKey = useMemo(() => new Map((avatars ?? []).map((avatar) => [avatar.key, avatar])), [avatars]);
  const selectedAvatar = editing ? avatarByKey.get(memberKey(editing)) : undefined;
  const busy = editing ? busyKey === memberKey(editing) : false;

  const save = async (name: string, body: AvatarInput) => {
    const key = memberKey(name);
    setBusyKey(key);
    setDialogError("");
    try {
      const response = await fetch(`/api/admin/avatars/${encodeURIComponent(key)}`, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await responseError(response, "Could not update that picture."));
      await load();
      setEditing(null);
    } catch (cause) {
      setDialogError(cause instanceof Error ? cause.message : "Could not update that picture.");
    } finally {
      setBusyKey(null);
    }
  };

  const reset = async (name: string) => {
    if (!window.confirm(`Reset ${name}'s picture to the default fish?`)) return;
    const key = memberKey(name);
    setBusyKey(key);
    setDialogError("");
    try {
      const response = await fetch(`/api/admin/avatars/${encodeURIComponent(key)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error(await responseError(response, "Could not reset that picture."));
      await load();
      setEditing(null);
    } catch (cause) {
      setDialogError(cause instanceof Error ? cause.message : "Could not reset that picture.");
    } finally {
      setBusyKey(null);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file || !editing) return;
    setDialogError("");
    try {
      const imageDataUrl = await shrinkImageToDataUrl(file);
      await save(editing, { kind: "upload", imageDataUrl });
    } catch (cause) {
      setDialogError(cause instanceof Error ? cause.message : "Could not read that picture.");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const openEditor = (name: string) => {
    setDialogError("");
    setEditing(name);
  };

  return (
    <section data-testid="section-admin-avatars" className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <p className="section-label">Member settings</p>
      <h2 className="mt-1 text-lg font-semibold">Player profile pictures</h2>
      <p className="mt-1 text-xs text-muted-foreground">Choose a preset, upload a photo, or reset any member to the default fish.</p>
      {error && (
        <div className="mt-3 flex items-center justify-between gap-3 text-xs text-destructive">
          <p role="alert">{error}</p>
          <button type="button" onClick={() => void load()} className="shrink-0 underline">Try again</button>
        </div>
      )}
      {members === null && !error && (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" />Loading members…</p>
      )}
      {members !== null && members.length === 0 && <p className="mt-4 text-sm text-muted-foreground">No configured members.</p>}
      {members && members.length > 0 && (
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {members.map((member) => {
            const key = memberKey(member.name);
            const avatar = avatarByKey.get(key);
            return (
              <li key={key} className="rounded-xl border border-border p-3">
                <span className="mx-auto block h-16 w-16 overflow-hidden rounded-full">
                  {avatar?.kind === "upload" ? (
                    <img
                      src={`/api/admin/avatars/image/${encodeURIComponent(key)}?v=${avatar.version}`}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <AvatarArt preset={avatar?.preset && AVATAR_PRESETS.some((preset) => preset.id === avatar.preset) ? avatar.preset as typeof AVATAR_PRESETS[number]["id"] : "fish"} uid={`admin-${key.replace(/[^a-z0-9]+/g, "-")}`} />
                  )}
                </span>
                <p className="mt-2 truncate text-center text-sm font-semibold">{member.name}</p>
                <p className="truncate text-center text-[11px] text-muted-foreground">
                  {avatar?.kind === "upload" ? "Uploaded photo" : avatar?.kind === "preset" ? avatar.preset : "Default fish"}
                </p>
                <button
                  type="button"
                  disabled={busyKey === key}
                  onClick={() => openEditor(member.name)}
                  data-testid={`button-admin-edit-avatar-${key.replace(/[^a-z0-9]+/g, "-")}`}
                  className="mt-2 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-border text-xs font-semibold hover:bg-secondary disabled:opacity-60"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit picture
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setEditing(null);
        }}
      >
        <DialogContent data-testid="dialog-admin-edit-avatar" className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit profile picture</DialogTitle>
            <DialogDescription>{editing ? `Choose a picture for ${editing}. Everyone in the club will see it.` : "Choose a member picture."}</DialogDescription>
          </DialogHeader>
          {editing && (
            <>
              <div className="flex items-center gap-4">
                <span className="block h-[72px] w-[72px] overflow-hidden rounded-full">
                  {selectedAvatar?.kind === "upload" ? (
                    <img
                      src={`/api/admin/avatars/image/${encodeURIComponent(memberKey(editing))}?v=${selectedAvatar.version}`}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <AvatarArt
                      preset={selectedAvatar?.kind === "preset" && AVATAR_PRESETS.some((preset) => preset.id === selectedAvatar.preset)
                        ? selectedAvatar.preset as typeof AVATAR_PRESETS[number]["id"]
                        : "fish"}
                      uid="admin-edit-preview"
                    />
                  )}
                </span>
                <p className="text-sm font-semibold">{editing}</p>
              </div>
              <div role="group" aria-label="Preset pictures" className="grid grid-cols-4 gap-2.5">
                {AVATAR_PRESETS.map((preset) => {
                  const selected = selectedAvatar
                    ? selectedAvatar.kind === "preset" && selectedAvatar.preset === preset.id
                    : preset.id === "fish";
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      disabled={busy}
                      onClick={() => void save(editing, { kind: "preset", preset: preset.id })}
                      aria-pressed={selected}
                      aria-label={preset.label}
                      className={`group relative flex flex-col items-center gap-1.5 rounded-xl border p-2 text-[11px] font-medium transition-colors disabled:opacity-60 ${
                        selected ? "border-primary bg-primary/10" : "border-border hover:border-primary/50 hover:bg-secondary"
                      }`}
                    >
                      <span className="block h-12 w-12 overflow-hidden rounded-full">
                        <AvatarArt preset={preset.id} uid={`admin-picker-${preset.id}`} />
                      </span>
                      {preset.label}
                      {selected && <Check className="absolute right-1 top-1 h-3.5 w-3.5 text-primary" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                className="sr-only"
                data-testid="input-admin-avatar-file"
                onChange={(event) => void onFile(event.target.files?.[0])}
              />
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => fileInput.current?.click()}
                  className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                >
                  <Camera className="h-4 w-4" />
                  {busy ? "Saving…" : "Upload a photo"}
                </button>
                {selectedAvatar && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void reset(editing)}
                    data-testid="button-admin-reset-avatar"
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-destructive/40 px-4 text-sm font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-60"
                  >
                    <Trash2 className="h-4 w-4" />
                    Default fish
                  </button>
                )}
              </div>
              {dialogError && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{dialogError}</p>}
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

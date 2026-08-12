import type { PlayerStatus, PlayerStatusAction } from "@/lib/player-status/model";

export async function changePlayerStatusClient(input: {
  roomId: string;
  playerId: string;
  action: PlayerStatusAction;
  expectedRevision?: number;
  getIdToken: () => Promise<string>;
  fetchImpl?: typeof fetch;
}): Promise<PlayerStatus> {
  const token = await input.getIdToken();
  const response = await (input.fetchImpl ?? fetch)(
    `/api/rooms/${encodeURIComponent(input.roomId)}/player-status/${encodeURIComponent(input.playerId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      cache: "no-store",
      body: JSON.stringify({
        action: input.action,
        ...(input.expectedRevision === undefined ? {} : { expectedRevision: input.expectedRevision }),
      }),
    },
  );
  const body = await response.json().catch(() => null) as { status?: PlayerStatus; error?: string } | null;
  if (!response.ok || !body?.status) throw new Error(body?.error ?? "Status konnte nicht gespeichert werden.");
  return body.status;
}

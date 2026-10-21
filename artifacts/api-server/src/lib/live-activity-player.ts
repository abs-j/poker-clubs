function normalizePlayerName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function resolveAttributedPlayer(
  value: string,
  memberName: string,
  availablePlayers: string[],
): string {
  const normalizedValue = value.trim().replace(/\s+/g, " ");
  if (!normalizedValue || normalizedValue.length > 80) {
    throw new Error("Enter a player name between 1 and 80 characters.");
  }

  if (normalizePlayerName(normalizedValue) === normalizePlayerName(memberName)) {
    return memberName;
  }

  const existingPlayer = availablePlayers.find(
    (player) => normalizePlayerName(player) === normalizePlayerName(normalizedValue),
  );
  return existingPlayer ?? normalizedValue;
}

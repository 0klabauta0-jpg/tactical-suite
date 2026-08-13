export type AuthoritativeEpoch = { signature: string; epoch: number };

export function advanceAuthoritativeEpoch(
  current: AuthoritativeEpoch,
  signature: string,
): AuthoritativeEpoch {
  return current.signature === signature
    ? current
    : { signature, epoch: current.epoch + 1 };
}

export function operationEpochIsCurrent(
  operationEpoch: number,
  authoritative: AuthoritativeEpoch,
): boolean {
  return operationEpoch === authoritative.epoch;
}

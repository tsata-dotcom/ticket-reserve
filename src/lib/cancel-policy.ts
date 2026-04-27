// 予約キャンセル料の算出。tour_types に保持された料率（%）を予約時に
// reservations.cancel_policy_snapshot に JSON で凍結している前提で、
// 来店日と現在日時（JST基準）の日数差に応じて料率を選び、ツアー金額に乗じる。

export type CancelPolicySnapshot = {
  "2days": number;
  "1day": number;
  "today": number;
};

export type CancelFeeResult = {
  fee: number;
  rate: number;
  freeCancel: boolean;
};

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function toJstDateOnly(date: Date): Date {
  const utc = date.getTime();
  const jst = new Date(utc + JST_OFFSET_MS);
  return new Date(
    Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate())
  );
}

function parseVisitDateJst(visitDate: string): Date {
  const [y, m, d] = visitDate.split("-").map((s) => parseInt(s, 10));
  return new Date(Date.UTC(y, m - 1, d));
}

export function calculateCancelFee(
  visitDate: string,
  cancelDate: Date,
  tourAmount: number,
  policy: CancelPolicySnapshot
): CancelFeeResult {
  const visit = parseVisitDateJst(visitDate);
  const cancelDay = toJstDateOnly(cancelDate);
  const diffDays = Math.round(
    (visit.getTime() - cancelDay.getTime()) / (24 * 60 * 60 * 1000)
  );

  let rate = 0;
  if (diffDays >= 3) {
    rate = 0;
  } else if (diffDays === 2) {
    rate = policy["2days"];
  } else if (diffDays === 1) {
    rate = policy["1day"];
  } else {
    rate = policy["today"];
  }

  const freeCancel = rate <= 0;
  const fee = freeCancel ? 0 : Math.floor((tourAmount * rate) / 100);
  return { fee, rate, freeCancel };
}

'use client';

import { AuthProvider } from '@/lib/auth-context';
import Header from '@/components/Header';

const ITEMS: { label: string; value: string }[] = [
  { label: '販売事業者', value: '株式会社伝食' },
  { label: '代表者', value: '代表取締役社長　田辺晃司' },
  { label: '所在地', value: '〒914-0811 福井県敦賀市中央町2-22-32' },
  { label: '連絡先', value: 'メール: info@kanifactory.com' },
  { label: '電話番号', value: '請求があった場合に遅滞なく開示いたします' },
  { label: '販売価格', value: '各体験プログラムのページに記載（税込表示）' },
  { label: '商品代金以外の必要料金', value: 'なし' },
  { label: '支払方法', value: 'クレジットカード（VISA / Mastercard / JCB / AMEX）' },
  { label: '支払時期', value: '予約確定時に即時決済' },
  { label: 'サービス提供時期', value: '予約日当日に施設にて提供' },
  {
    label: 'キャンセル・返金',
    value:
      '予約日の3日前までキャンセル可能（全額返金）。それ以降のキャンセルは返金不可。',
  },
  { label: '返品・交換', value: 'サービスの性質上、返品・交換はお受けできません' },
];

function LegalContent() {
  return (
    <>
      <Header />
      <main className="max-w-[600px] md:max-w-[800px] mx-auto px-4 py-6">
        <h1 className="text-xl font-bold text-gray-800 mb-6">
          特定商取引法に基づく表記
        </h1>

        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <tbody>
              {ITEMS.map((item, i) => (
                <tr
                  key={item.label}
                  className={i !== ITEMS.length - 1 ? 'border-b border-gray-200' : ''}
                >
                  <th className="bg-primary-light text-primary font-bold text-left align-top px-4 py-3 w-36 md:w-56 whitespace-nowrap">
                    {item.label}
                  </th>
                  <td className="px-4 py-3 text-gray-700 leading-relaxed">
                    {item.value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-gray-400 mt-6 text-center">
          本表記は特定商取引法第11条に基づき掲載しています。
        </p>
      </main>
    </>
  );
}

export default function LegalPage() {
  return (
    <AuthProvider>
      <LegalContent />
    </AuthProvider>
  );
}

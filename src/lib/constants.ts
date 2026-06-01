export const GROUP_NAMES: Record<string, string> = {
  A: 'M90S',
  B: '300NP',
  C: '100G20',
  D: '950X01',
}

export const LOT_ORDER = [
  '1','2','3','4','5','6',
  '7','8','9','10','国①','国②'
]

export const LOT_LABELS: Record<string, string> = {
  '1':  '4／初〜',
  '2':  '4／末〜',
  '3':  '5／末〜',
  '4':  '6／中〜',
  '5':  '7／末〜',
  '6':  '9／初〜',
  '7':  '10／初〜',
  '8':  '11／初〜',
  '9':  '11／中〜',
  '10': '12／中〜',
  '国①': '1／中〜',
  '国②': '2／初〜',
}

export const DELIVERY_START_DATE = new Date('2026-04-01')

export const EDI_ENCODING  = 'shift-jis'
export const EDI_SEPARATOR = '\t'

// 情報区分コード → file type
export const FILE_TYPE_MAP: Record<string, string> = {
  '0502': 'normal',
  '0503': 'henkou',
  '0504': 'torikeshi',
}
import { useCoupleAuth } from './useCoupleAuth'

/** 复用现有认证与情侣配对状态，避免维护第二套登录状态或重复订阅。 */
export function useAuth() {
  return useCoupleAuth()
}

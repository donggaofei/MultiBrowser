export interface Account {
  id: string;
  name: string;
  url: string;
  createdAt: number;
}

export interface NavState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
}

export const DEFAULT_URL = 'https://qianchuan.jinritemai.com/';

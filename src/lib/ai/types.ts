export interface ProductInfo {
  brand: string | null;
  productLine: string | null;
  model: string | null;
  variantEdition: string | null;
  color: string | null;
  productType: string | null;
  canonicalName: string;
  coreTerms: string[];
}

export interface LotItem {
  product: string;
  quantity: number;
}

export interface LotInfo {
  isLot: boolean;
  itemsPerUnit: number;
  itemBreakdown: LotItem[];
  confidence: "high" | "medium" | "low";
}

export interface ProductAndLotInfo {
  product: ProductInfo;
  lot: LotInfo;
}

export interface CompletionOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

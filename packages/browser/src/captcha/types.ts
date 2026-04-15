export type CaptchaType = "recaptcha-v2" | "recaptcha-v3" | "turnstile" | "hcaptcha";

export interface CaptchaChallenge {
  type: CaptchaType;
  siteKey: string;
  pageUrl: string;
  /** v3 only — action field. */
  action?: string;
  /** v3 only — minimum score. */
  minScore?: number;
}

export interface CaptchaSolution {
  token: string;
  solvedInMs: number;
}

export class CaptchaError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "CaptchaError";
  }
}

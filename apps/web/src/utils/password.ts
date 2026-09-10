export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export interface PasswordRequirement {
  key: "length" | "maxLength" | "uppercase" | "lowercase" | "number";
  label: string;
  ok: boolean;
}

/** 与 API `validate_password_strength` 保持一致的客户端提示规则。 */
export function getPasswordRequirements(password: string): PasswordRequirement[] {
  // Python 的 len() 按 Unicode 码点计数；Array.from() 避免 JS UTF-16 code unit
  // 让包含代理对的密码在客户端和服务端得到不同的长度判断。
  const codePointLength = Array.from(password).length;
  return [
    {
      key: "length",
      label: `至少 ${PASSWORD_MIN_LENGTH} 位`,
      ok: codePointLength >= PASSWORD_MIN_LENGTH,
    },
    {
      key: "maxLength",
      label: `不超过 ${PASSWORD_MAX_LENGTH} 位`,
      ok: codePointLength <= PASSWORD_MAX_LENGTH,
    },
    { key: "uppercase", label: "含大写字母", ok: /[A-Z]/.test(password) },
    { key: "lowercase", label: "含小写字母", ok: /[a-z]/.test(password) },
    { key: "number", label: "含数字", ok: /\p{Decimal_Number}/u.test(password) },
  ];
}

export function isPasswordStrong(password: string): boolean {
  return getPasswordRequirements(password).every((rule) => rule.ok);
}

export function getPasswordValidationErrors(password: string): string[] {
  return getPasswordRequirements(password)
    .filter((rule) => !rule.ok)
    .map((rule) => rule.label);
}

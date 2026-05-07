export interface SecretLeakFinding {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
}

interface SecretLeakRule {
  readonly name: string;
  readonly pattern: RegExp;
}

const SECRET_LEAK_RULES: readonly SecretLeakRule[] = [
  { name: "aws-access-key-id", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/ },
  {
    name: "private-key-block",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    name: "jwt-literal",
    pattern: /\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/,
  },
];

export const DEFAULT_DENIED_LICENSES = [
  "AGPL-1.0",
  "AGPL-3.0",
  "GPL-2.0",
  "GPL-3.0",
  "LGPL-2.0",
  "LGPL-2.1",
  "LGPL-3.0",
] as const;

export interface PackageLicenseRecord {
  readonly name: string;
  readonly version: string;
  readonly license: string | null;
}

export interface LicensePolicyViolation {
  readonly packageName: string;
  readonly version: string;
  readonly license: string;
}

export function scanTextForSecretLeaks(
  file: string,
  text: string,
): SecretLeakFinding[] {
  const findings: SecretLeakFinding[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const rule of SECRET_LEAK_RULES) {
      if (rule.pattern.test(line)) {
        findings.push({ file, line: index + 1, rule: rule.name });
      }
    }
  });
  return findings;
}

export function scanManyTextFiles(
  files: readonly { readonly path: string; readonly text: string }[],
): SecretLeakFinding[] {
  return files.flatMap((file) => scanTextForSecretLeaks(file.path, file.text));
}

export function workflowReferencesRepositorySecrets(workflowText: string): boolean {
  return /\bsecrets\./.test(workflowText);
}

export function deniedLicenseViolations(
  records: readonly PackageLicenseRecord[],
  denied: readonly string[] = DEFAULT_DENIED_LICENSES,
): LicensePolicyViolation[] {
  const deniedSet = new Set(denied.map((license) => license.toLowerCase()));
  return records.flatMap((record) => {
    if (record.license === null) return [];
    const normalized = record.license.trim().toLowerCase();
    if (!deniedSet.has(normalized)) return [];
    return [{
      packageName: record.name,
      version: record.version,
      license: record.license,
    }];
  });
}

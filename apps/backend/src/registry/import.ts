import { readFileSync } from 'node:fs';
import { prisma } from '../shared/prisma.js';
import { logger } from '../shared/logger.js';
import { houseKey, parseRegistryAddress, streetKey } from './address.js';

// Loads open data of the Territory Development Fund (аис.фрт.рф/opendata)
// into the registry tables. The files are downloaded by hand: the portal is
// not reachable from every server.
//
//   node dist/registry/import.js companies export-reestruo-00-YYYYMMDD.csv
//   node dist/registry/import.js houses export-kr1_1-66-YYYYMMDD.csv
//
// "companies" — Реестр управляющих организаций по Российской Федерации.
// "houses" — Многоквартирные дома в региональной программе капремонта
// (отчёт КР 1.1) of one region; reloading a region replaces its houses.

export function parseCsv(text: string, separator = ';'): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index += 1; } else quoted = false;
      } else field += char;
    } else if (char === '"') quoted = true;
    else if (char === separator) { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field); field = '';
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
    } else field += char;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function records(file: string) {
  const [header, ...rows] = parseCsv(readFileSync(file, 'utf8').replace(/^﻿/, ''));
  if (!header) return [];
  return rows.map((row) => Object.fromEntries(header.map((name, index) => [name.trim(), (row[index] ?? '').trim()])));
}

const text = (value: string | undefined) => (value ? value : null);
const integer = (value: string | undefined) => {
  const number = Number((value ?? '').replace(/\s/g, '').replace(',', '.'));
  return value && Number.isFinite(number) ? Math.round(number) : null;
};
const decimal = (value: string | undefined) => {
  const number = Number((value ?? '').replace(/\s/g, '').replace(',', '.'));
  return value && Number.isFinite(number) ? number : null;
};

async function inBatches<T>(items: T[], size: number, save: (batch: T[]) => Promise<unknown>) {
  for (let index = 0; index < items.length; index += size) await save(items.slice(index, index + size));
}

export async function importCompanies(file: string) {
  const data = records(file)
    .filter((row) => row.id && row.name_full)
    .map((row) => ({
      id: row.id!,
      subject: row.subject_rf ?? '',
      nameFull: row.name_full!,
      nameShort: text(row.name_short),
      inn: text(row.inn),
      ogrn: text(row.orn ?? row.ogrn),
      legalAddress: text(row.legal_address),
      actualAddress: text(row.actual_address),
      phone: text(row.phone),
      email: text(row.email),
      site: text(row.site),
      housesCount: integer(row.count_mkd),
    }));
  await prisma.registryCompany.deleteMany({});
  await inBatches(data, 2000, (batch) => prisma.registryCompany.createMany({ data: batch, skipDuplicates: true }));
  return data.length;
}

export async function importHouses(file: string) {
  const rows = records(file);
  const subjects = new Set<string>();
  const data = rows.flatMap((row) => {
    const parsed = parseRegistryAddress(row.address ?? '');
    const id = row.houseguid || row.mkd_code || row.house_id;
    if (!parsed || !id) return [];
    subjects.add(row.subject_rf ?? '');
    return [{
      id,
      subject: row.subject_rf ?? '',
      fiasGuid: text(row.houseguid),
      address: row.address!,
      locality: parsed.locality,
      streetKey: streetKey(parsed.street),
      houseKey: houseKey(parsed.house),
      builtYear: integer(row.commission_year),
      floors: integer(row.number_floors_max),
      apartments: integer(row.living_rooms_amount) ?? integer(row.total_rooms_amount),
      residents: integer(row.total_ppl),
      totalArea: decimal(row.total_sq),
    }];
  });
  await prisma.registryHouse.deleteMany({ where: { subject: { in: [...subjects] } } });
  await inBatches(data, 2000, (batch) => prisma.registryHouse.createMany({ data: batch, skipDuplicates: true }));
  return { houses: data.length, skipped: rows.length - data.length, subjects: [...subjects] };
}

async function main() {
  const [kind, file] = process.argv.slice(2);
  if (!file || (kind !== 'companies' && kind !== 'houses')) {
    logger.error('Usage: registry/import.js companies|houses <file.csv>');
    process.exitCode = 1;
    return;
  }
  const result = kind === 'companies' ? { companies: await importCompanies(file) } : await importHouses(file);
  logger.info(result, 'Open registry imported');
}

if (process.argv[1] && /registry[\\/]import\.(js|ts)$/.test(process.argv[1])) {
  main().catch((error) => { logger.error({ error }, 'Registry import failed'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
}

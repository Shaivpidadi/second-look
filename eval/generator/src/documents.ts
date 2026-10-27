import {
  computeAwbCheckDigit,
  computeContainerCheckDigit,
} from "@second-look/validators";
import { digitString, int, pick, type Rng } from "./prng.ts";

export interface Bol {
  kind: "bol";
  bolNumber: string;
  shipper: string;
  consignee: string;
  containerNumber: string;
  sealNumber: string;
  cartons: number;
  weightKg: number;
  vessel: string;
  portOfLoading: string;
  portOfDischarge: string;
}

export interface AwbDoc {
  kind: "awb";
  awbNumber: string;
  origin: string;
  destination: string;
  pieces: number;
  weightKg: number;
}

export interface Pod {
  kind: "pod";
  podNumber: string;
  bolRef: string;
  receivedCartons: number;
  exceptionNote: string | null;
  receiver: string;
  date: string;
}

export interface SyntheticForm {
  formId: string;
  seed: number;
  bol: Bol;
  awb: AwbDoc;
  pod: Pod;
}

const SHIPPERS = [
  "ACME TRADING CO",
  "HARBOUR LINE GOODS",
  "MERIDIAN FOODS LTD",
  "BLUE ANCHOR SUPPLY",
  "NORTHDOCK APPAREL",
] as const;

const VESSELS = [
  "MV HARBOUR STAR",
  "MV MERIDIAN BAY",
  "MV NORTHERN LIGHT",
  "MV CAPE ORION",
] as const;

const PORTS = [
  "NEWARK",
  "SAVANNAH",
  "ROTTERDAM",
  "SINGAPORE",
  "HAMBURG",
  "BUSAN",
] as const;

const AIRPORTS = ["JFK", "EWR", "LHR", "FRA", "SIN", "ICN"] as const;

const OWNERS = ["CSQU", "TCLU", "MSKU", "TRHU", "HLXU"] as const;

function generateAwbNumber(rng: Rng): string {
  const firstTen = digitString(rng, 3) + digitString(rng, 7);
  return firstTen + computeAwbCheckDigit(firstTen);
}

function generateContainerNumber(rng: Rng): string {
  const firstTen = pick(rng, OWNERS) + digitString(rng, 6);
  return firstTen + computeContainerCheckDigit(firstTen);
}

export function generateForm(formId: string, seed: number, rng: Rng): SyntheticForm {
  const cartons = int(rng, 20, 400);
  const bolWeight = cartons * int(rng, 8, 25);
  const pieces = int(rng, 5, 120);
  const bolNumber = `BOL-${digitString(rng, 8)}`;
  const loading = pick(rng, PORTS);
  let discharge: string = pick(rng, PORTS);
  if (discharge === loading) discharge = "SANTOS";
  const origin = pick(rng, AIRPORTS);
  let destination: string = pick(rng, AIRPORTS);
  if (destination === origin) destination = "NRT";

  const bol: Bol = {
    kind: "bol",
    bolNumber,
    shipper: pick(rng, SHIPPERS),
    consignee: pick(rng, SHIPPERS),
    containerNumber: generateContainerNumber(rng),
    sealNumber: `SEAL-${digitString(rng, 6)}`,
    cartons,
    weightKg: bolWeight,
    vessel: pick(rng, VESSELS),
    portOfLoading: loading,
    portOfDischarge: discharge,
  };

  const awb: AwbDoc = {
    kind: "awb",
    awbNumber: generateAwbNumber(rng),
    origin,
    destination,
    pieces,
    weightKg: pieces * int(rng, 8, 25),
  };

  const pod: Pod = {
    kind: "pod",
    podNumber: `POD-${digitString(rng, 8)}`,
    bolRef: bolNumber,
    receivedCartons: cartons,
    exceptionNote: rng() < 0.3 ? `${int(rng, 1, 3)} CARTONS DAMAGED` : null,
    receiver: pick(rng, SHIPPERS),
    date: `2026-10-${String(int(rng, 1, 28)).padStart(2, "0")}`,
  };

  return { formId, seed, bol, awb, pod };
}

/**
 * Regenerates tests/fixtures/imports/*. Run with `pnpm --filter @outreach/importer fixtures`.
 * The files are committed so the tests read real bytes (BOMs, Windows-1252, UTF-16, XLSX) exactly as users upload them.
 * The 50,001-row case is generated inside the test instead of being committed (2.5 MB of repeated rows).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";

const dir = join(import.meta.dirname, "../../../tests/fixtures/imports");
mkdirSync(dir, { recursive: true });
const put = (name: string, data: string | Buffer) => writeFileSync(join(dir, name), data);

const BOM = "﻿";

put(
  "utf8-bom.csv",
  BOM +
    [
      "First Name,Last Name,Email,Company,Website,Title",
      "Jane,Doe,jane@acme.example.com,Acme,acme.example.com,COO",
      "Bob,Ray,bob@acme.example.com,Acme,acme.example.com,Head of Operations",
      "Cara,Lin,cara@beta.example.com,Beta,https://www.beta.example.com/about,CTO",
    ].join("\r\n") + "\r\n",
);

put(
  "windows-1252.csv",
  Buffer.from(
    ["First Name,Last Name,Email,Company,Title", "José,Müller,jose@beta.example.com,Béta Ltd,Directeur général", "Zoë,Åberg,zoe@gamma.example.com,Gamma,Chef de projet"].join("\r\n") + "\r\n",
    "latin1",
  ),
);

put(
  "semicolon.csv",
  ["First Name;Last Name;Email;Company;Title", "Ana;Silva;ana@delta.example.com;Delta;CEO", "Ravi;Kumar;ravi@delta.example.com;Delta;COO"].join("\n") + "\n",
);

put(
  "quoted-commas-newlines.csv",
  [
    "First Name,Last Name,Email,Company,Title",
    'Dan,Poe,dan@epsilon.example.com,"Epsilon, Inc.","Head of\nOperations"',
    'Eve,Ng,eve@epsilon.example.com,"Epsilon ""Labs"", Inc.",Director',
  ].join("\r\n") + "\r\n",
);

put(
  "blank-rows.csv",
  ["First Name,Last Name,Email", "", "Fay,Obi,fay@zeta.example.com", ",,", "   ,  ,  ", "Gus,Ito,gus@zeta.example.com", "", ""].join("\n"),
);

put("duplicate-headers.csv", ["Name,Email,Name,Company", "Hal Roe,hal@eta.example.com,Hal R.,Eta", "Ida Fox,ida@eta.example.com,Ida F.,Eta"].join("\n") + "\n");

put("no-header.csv", ["Jo Park,jo@theta.example.com,Theta,CFO", "Kim Sol,kim@theta.example.com,Theta,CTO"].join("\n") + "\n");

put(
  "apollo-export.csv",
  [
    "First Name,Last Name,Title,Company,Company Name for Emails,Email,Email Status,Seniority,Departments,# Employees,Industry,Person Linkedin Url,Website,Company Linkedin Url,Country",
    'Lia,Moss,COO,Iota Ltd,Iota,lia@iota.example.com,Verified,c_suite,operations,"1,200",software,https://www.linkedin.com/in/lia-moss/?trk=x,https://www.iota.example.com,https://linkedin.com/company/iota,India',
    "Max,Dahl,CTO,Kappa,Kappa,max@kappa.example.com,Guessed,c_suite,engineering,55,logistics,linkedin.com/in/max-dahl,kappa.example.com,,United States",
    "Nia,Quin,CEO,Lambda,Lambda,nia@lambda.example.com,Bounced,c_suite,,11-50,saas,,lambda.example.com,,India",
  ].join("\n") + "\n",
);

put(
  "messy-emails.csv",
  [
    "Full Name,Email,Website,Employees",
    '"Doe, Jane", Jane.DOE@Acme.COM ,https://www.acme.example.com/x,"2,000"',
    "Bob Ray,Bob Ray <bob@mu.example.com>,mu.example.com,1.5k",
    "Cy Lee,c y@nu.example.com,nu.example.com,50+",
    "Di Wu,a@xi.example.com; b@xi.example.com,xi.example.com,abc",
    "Ed Fry,not-an-email,omicron.example.com,",
    "Flo Kay,flo@gmail.com,https://www.linkedin.com/company/foo,",
  ].join("\n") + "\n",
);

put(
  "research-first.csv",
  ["Name,Company,LinkedIn", "Gil Ash,Pi Corp,https://www.linkedin.com/in/gil-ash/", "Hue Bao,Rho Corp,", ",,"].join("\n") + "\n",
);

put(
  "hindi-accented.csv",
  BOM + ["Name,Email,Company", "राहुल शर्मा,rahul@sigma.example.com,सिग्मा", "Zoë Müller,zoe@tau.example.com,Tau", "José Álvarez,jose@upsilon.example.com,Upsilon", "李雷,li@phi.example.com,Phi"].join("\n") + "\n",
);

put(
  "utf16le.csv",
  Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(["First Name,Last Name,Email", "Una,Vik,una@chi.example.com", "Wes,Xu,wes@chi.example.com"].join("\r\n") + "\r\n", "utf16le")]),
);

async function xlsx() {
  const wb = new ExcelJS.Workbook();
  const notes = wb.addWorksheet("Notes");
  notes.addRow(["Read me"]);
  const leads = wb.addWorksheet("Leads");
  leads.addRow(["First Name", "Last Name", "Email", "Company", "Employees", "Zip", "Signed Up", "Profile", "Score"]);
  leads.addRow(["Yan", "Zed", "yan@psi.example.com", "Psi", 1200, "00501", new Date(Date.UTC(2026, 8, 1)), { text: "Yan on LinkedIn", hyperlink: "https://www.linkedin.com/in/yan-zed/" }, { formula: "40+30", result: 70 }]);
  leads.addRow(["Zia", "Abe", "zia@omega.example.com", "Omega", "300", "10001", new Date(Date.UTC(2026, 9, 15, 13, 30)), "", { formula: "10*2", result: 20 }]);
  leads.addRow([]);
  leads.addRow(["Ola", "Bai", { richText: [{ text: "ola@" }, { text: "omega.example.com" }] }, "Omega", 25, "", "", "", ""]);
  const other = wb.addWorksheet("Other");
  other.addRow(["Name", "Email"]);
  other.addRow(["Pat Cox", "pat@other.example.com"]);
  await wb.xlsx.writeFile(join(dir, "excel-types.xlsx"));
}

xlsx().then(() => console.log(`fixtures written to ${dir}`));

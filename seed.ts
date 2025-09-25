import 'dotenv/config';
import fs from 'fs';
import csv from 'csv-parser';
import { DbStorage } from './server/storage';
import dotenv from 'dotenv'; // <-- ADD THIS LINE
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.resolve(__dirname, '.env');
const envConfig = dotenv.parse(fs.readFileSync(envPath));
const databaseUrl = envConfig.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("Could not find DATABASE_URL in the .env file.");
}

const storage = new DbStorage(databaseUrl); 
const csvFilePath = './employees.csv';

async function syncFromCSV() {
  const employeesFromCSV: any[] = [];
  console.log('Reading employees from CSV file...');

  fs.createReadStream(csvFilePath)
    .pipe(csv())
    .on('data', (row) => {
      employeesFromCSV.push({
        name: row["Agent Name"],
        role: row.Department,
        email: `${row.Extension}@company.com`,
        initials: row["Agent Name"] ? (
  (parts => parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : parts[0].slice(0, 2))
  (row["Agent Name"].split(' '))
).toUpperCase() : 'XX',
      });
    })
    .on('end', async () => {
      console.log('CSV file successfully processed. Starting database sync...');
      for (const employee of employeesFromCSV) {
        if (!employee.name || !employee.email) {
          console.log("Skipping row with missing name or email...");
          continue;
        }
        try {
          const existingEmployee = await storage.getEmployeeByEmail(employee.email);

          if (existingEmployee) {
            console.log(`Skipping existing employee: ${employee.name}`);
          } else {
            await storage.createEmployee(employee);
            console.log(`Created new employee: ${employee.name}`);
          }
        } catch (error) {
          console.error(`Failed to sync ${employee.name}:`, error);
        }
      }
      console.log('Database sync complete!');
    });
}

syncFromCSV();
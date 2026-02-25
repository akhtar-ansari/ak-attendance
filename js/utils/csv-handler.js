// AK Attendance - CSV Handler
const CSVHandler = {
    // Parse CSV file to array of objects
    parse(csvText) {
        const lines = csvText.trim().split('\n');
        if (lines.length < 2) {
            return { success: false, error: 'CSV file is empty or has no data rows' };
        }

        // Parse header
        const headers = this.parseLine(lines[0]);
        const requiredHeaders = ['iqama_number', 'name', 'nationality', 'date_of_joining', 'department_code'];
        
        // Validate headers
        const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));
        if (missingHeaders.length > 0) {
            return { 
                success: false, 
                error: `Missing required columns: ${missingHeaders.join(', ')}` 
            };
        }

        // Parse data rows
        const data = [];
        const errors = [];

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const values = this.parseLine(line);
            const row = {};

            headers.forEach((header, index) => {
                row[header] = values[index]?.trim() || '';
            });

            // Validate row
            const rowErrors = this.validateRow(row, i + 1);
            if (rowErrors.length > 0) {
                errors.push({ row: i + 1, errors: rowErrors });
            } else {
                data.push({
                    iqamaNumber: row.iqama_number,
                    name: row.name,
                    nationality: row.nationality,
                    dateOfJoining: this.parseDate(row.date_of_joining),
                    departmentCode: row.department_code.toUpperCase(),
                    status: row.status || 'active'
                });
            }
        }

        return { 
            success: true, 
            data, 
            errors,
            totalRows: lines.length - 1,
            validRows: data.length,
            errorRows: errors.length
        };
    },

    // Parse single CSV line (handles quoted values)
    parseLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];

            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current.trim());

        return result;
    },

    // Validate single row
    validateRow(row, rowNum) {
        const errors = [];

        if (!row.iqama_number || row.iqama_number.length < 5) {
            errors.push('Invalid Iqama number');
        }

        if (!row.name || row.name.length < 2) {
            errors.push('Name is required');
        }

        if (!row.nationality) {
            errors.push('Nationality is required');
        }

        if (!row.date_of_joining) {
            errors.push('Date of joining is required');
        } else {
            const parsed = this.parseDate(row.date_of_joining);
            if (!parsed) {
                errors.push('Invalid date format (use DD/MM/YYYY)');
            }
        }

        if (!row.department_code) {
            errors.push('Department code is required');
        }

        return errors;
    },

    // Parse date from DD/MM/YYYY to YYYY-MM-DD
    parseDate(dateStr) {
        if (!dateStr) return null;

        // Try DD/MM/YYYY format
        const parts = dateStr.split('/');
        if (parts.length === 3) {
            const day = parts[0].padStart(2, '0');
            const month = parts[1].padStart(2, '0');
            const year = parts[2];
            return `${year}-${month}-${day}`;
        }

        // Try YYYY-MM-DD format (already correct)
        if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
            return dateStr;
        }

        return null;
    },

    // Generate CSV template
    generateTemplate() {
        const headers = 'iqama_number,name,nationality,date_of_joining,department_code,status';
        const example1 = '1234567890,Ahmed Hassan,Saudi,15/01/2025,WH,active';
        const example2 = '0987654321,Mohammad Ali,Indian,01/02/2025,ST,active';
        
        return `${headers}\n${example1}\n${example2}`;
    },

    // Download template
    downloadTemplate() {
        const csv = this.generateTemplate();
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = 'labor_import_template.csv';
        a.click();
        
        URL.revokeObjectURL(url);
    },

    // Export data to CSV
    exportToCSV(data, filename) {
        if (!data || data.length === 0) {
            Toast.error('No data to export');
            return;
        }

        const headers = Object.keys(data[0]);
        const rows = data.map(row => 
            headers.map(h => {
                const val = row[h]?.toString() || '';
                // Escape quotes and wrap in quotes if contains comma
                if (val.includes(',') || val.includes('"')) {
                    return `"${val.replace(/"/g, '""')}"`;
                }
                return val;
            }).join(',')
        );

        const csv = [headers.join(','), ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `${filename}_${DateUtils.today()}.csv`;
        a.click();
        
        URL.revokeObjectURL(url);
    }
};
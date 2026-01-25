import * as React from 'react';
interface CSVImporterProps {
    socket: any;
    data?: any;
    onError?: (error: string) => void;
    onChange?: (data: any) => void;
    instance: number;
    adapterName: string;
}
declare const CSVImporter: React.FC<CSVImporterProps>;
export default CSVImporter;

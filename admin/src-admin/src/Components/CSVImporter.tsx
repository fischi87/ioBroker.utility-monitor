import * as React from 'react';
import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import {
    Box,
    Typography,
    Paper,
    Button,
    CircularProgress,
    Alert,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Grid,
    TextField,
    Fade,
    IconButton,
    Tooltip,
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import InfoIcon from '@mui/icons-material/Info';
import DeleteIcon from '@mui/icons-material/Delete';

interface CSVImporterProps {
    socket: any;
    data?: any;
    onError?: (error: string) => void;
    onChange?: (data: any) => void;
    instance: number;
    adapterName: string;
}

const CSVImporter: React.FC<CSVImporterProps> = ({ socket, instance, adapterName }) => {
    const [file, setFile] = useState<File | null>(null);
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    const [type, setType] = useState('gas');
    const [meterName, setMeterName] = useState('');

    // Theme-specific colors for utility types
    const getTypeColor = () => {
        switch (type) {
            case 'gas':
                return '#ff9800'; // Orange
            case 'water':
                return '#2196f3'; // Blue
            case 'electricity':
                return '#fbc02d'; // Yellow
            case 'pv':
                return '#4caf50'; // Green
            default:
                return '#2196f3'; // ioBroker Blue
        }
    };

    const ioBrokerBlue = '#2196f3';

    const onDrop = useCallback((acceptedFiles: File[]) => {
        if (acceptedFiles.length > 0) {
            setFile(acceptedFiles[acceptedFiles.length - 1]);
            setError(null);
            setResult(null);
        }
    }, []);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: {
            'text/csv': ['.csv'],
            'text/plain': ['.csv'],
        },
        maxFiles: 1,
    });

    const handleUpload = async () => {
        if (!file || !socket) return;

        const finalMeterName = meterName.trim();

        if (!finalMeterName) {
            setError('Bitte gib einen Zählernamen ein.');
            return;
        }

        if (!/^[a-zA-Z0-9_]+$/.test(finalMeterName)) {
            setError('Der Zählername darf nur Buchstaben, Zahlen und Unterstriche enthalten.');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const reader = new FileReader();
            reader.onload = async e => {
                const content = e.target?.result as string;

                try {
                    const response = await socket.sendTo(`${adapterName}.${instance}`, 'importCSV', {
                        type,
                        meterName: finalMeterName,
                        content,
                        format: 'generic',
                    });

                    if (response && response.error) {
                        setError(response.error);
                    } else {
                        setResult(response);
                        setFile(null);
                        setMeterName('');
                    }
                } catch (sendError: any) {
                    setError('Kommunikationsfehler: ' + sendError.message);
                } finally {
                    setLoading(false);
                }
            };
            reader.readAsDataURL(file);
        } catch (err: any) {
            setError('Fehler beim Lesen der Datei: ' + err.message);
            setLoading(false);
        }
    };

    return (
        <Fade
            in={true}
            timeout={800}
        >
            <Box
                sx={{
                    maxWidth: 900,
                    margin: '0 auto',
                    p: { xs: 2, sm: 4 },
                }}
            >
                <Box
                    sx={{
                        mb: 4,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 2,
                        borderBottom: '2px solid',
                        borderColor: ioBrokerBlue,
                        pb: 2,
                    }}
                >
                    <Typography
                        variant="h5"
                        component="h1"
                        sx={{ fontWeight: 800, color: ioBrokerBlue, letterSpacing: '-0.5px' }}
                    >
                        Historischer Daten-Import
                    </Typography>
                    <Box sx={{ flexGrow: 1 }} />
                    <Tooltip title="Hilfe zum Import">
                        <IconButton
                            size="small"
                            onClick={() =>
                                window.open('https://github.com/fischi87/ioBroker.utility-monitor#csv-import', '_blank')
                            }
                        >
                            <InfoIcon color="primary" />
                        </IconButton>
                    </Tooltip>
                </Box>

                <Paper
                    elevation={0}
                    sx={{
                        p: 3,
                        mb: 4,
                        borderRadius: 3,
                        bgcolor: 'background.default',
                        border: '1px solid',
                        borderColor: 'divider',
                    }}
                >
                    <Grid
                        container
                        spacing={3}
                    >
                        <Grid
                            item
                            xs={12}
                            sm={6}
                        >
                            <FormControl
                                fullWidth
                                size="small"
                            >
                                <InputLabel>Medien-Typ</InputLabel>
                                <Select
                                    value={type}
                                    label="Medien-Typ"
                                    onChange={e => setType(e.target.value)}
                                    sx={{
                                        borderRadius: 2,
                                        '& .MuiOutlinedInput-notchedOutline': { borderColor: getTypeColor() + '88' },
                                        '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: getTypeColor() },
                                    }}
                                >
                                    <MenuItem value="gas">🔥 Gas</MenuItem>
                                    <MenuItem value="water">💦 Wasser</MenuItem>
                                    <MenuItem value="electricity">⚡ Strom</MenuItem>
                                    <MenuItem value="pv">☀️ PV</MenuItem>
                                </Select>
                            </FormControl>
                        </Grid>
                        <Grid
                            item
                            xs={12}
                            sm={6}
                        >
                            <TextField
                                fullWidth
                                size="small"
                                label="Name des Imports (z.B. historisch)"
                                variant="outlined"
                                value={meterName}
                                onChange={e => setMeterName(e.target.value)}
                                placeholder="Nur Buchstaben, Zahlen, _"
                                error={meterName !== '' && !/^[a-zA-Z0-9_]+$/.test(meterName)}
                                helperText="Wird als Ordner-Name verwendet"
                                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
                            />
                        </Grid>
                    </Grid>
                </Paper>

                <Box
                    {...getRootProps()}
                    sx={{
                        p: 6,
                        textAlign: 'center',
                        cursor: 'pointer',
                        borderRadius: 4,
                        border: '2px dashed',
                        borderColor: isDragActive ? 'primary.main' : 'divider',
                        bgcolor: isDragActive ? 'primary.main' + '11' : 'background.paper',
                        transition: 'all 0.2s ease-in-out',
                        '&:hover': {
                            borderColor: 'primary.main',
                            bgcolor: 'action.hover',
                            transform: 'translateY(-2px)',
                        },
                    }}
                >
                    <input {...getInputProps()} />
                    <CloudUploadIcon
                        sx={{
                            fontSize: 64,
                            color: isDragActive ? 'primary.main' : 'text.disabled',
                            mb: 2,
                            transition: 'color 0.3s',
                        }}
                    />

                    {file ? (
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                            <Typography
                                variant="h6"
                                sx={{ fontWeight: 600 }}
                            >
                                {file.name}
                            </Typography>
                            <IconButton
                                size="small"
                                onClick={e => {
                                    e.stopPropagation();
                                    setFile(null);
                                }}
                                color="error"
                            >
                                <DeleteIcon fontSize="small" />
                            </IconButton>
                        </Box>
                    ) : (
                        <Box>
                            <Typography
                                variant="h6"
                                sx={{ color: 'text.primary', mb: 1 }}
                            >
                                {isDragActive ? 'Jetzt loslassen!' : 'CSV-Datei hineinziehen'}
                            </Typography>
                            <Typography
                                variant="body2"
                                color="text.secondary"
                            >
                                oder klicken, um eine Datei auszuwählen
                            </Typography>
                        </Box>
                    )}
                </Box>

                <Box sx={{ mt: 4, display: 'flex', justifyContent: 'center' }}>
                    <Button
                        variant="contained"
                        onClick={handleUpload}
                        disabled={!file || loading}
                        startIcon={
                            loading ? (
                                <CircularProgress
                                    size={20}
                                    color="inherit"
                                />
                            ) : (
                                <CheckCircleIcon />
                            )
                        }
                        sx={{
                            px: 6,
                            py: 1.5,
                            borderRadius: 10,
                            fontWeight: 700,
                            textTransform: 'none',
                            fontSize: '1.1rem',
                            boxShadow: 'none',
                            bgcolor: ioBrokerBlue,
                            '&:hover': {
                                bgcolor: '#1976d2', // Darker Blue
                                boxShadow: '0 4px 12px 0 rgba(0,0,0,0.2)',
                            },
                        }}
                    >
                        {loading ? 'Verarbeite Daten...' : 'Import starten'}
                    </Button>
                </Box>

                {error && (
                    <Alert
                        severity="error"
                        variant="filled"
                        sx={{ mt: 3, borderRadius: 2 }}
                    >
                        {error}
                    </Alert>
                )}

                {result && (
                    <Fade in={true}>
                        <Alert
                            icon={<CheckCircleIcon fontSize="inherit" />}
                            severity="success"
                            variant="outlined"
                            sx={{ mt: 3, borderRadius: 2, border: '2px solid', borderColor: 'success.main' }}
                        >
                            <Typography
                                variant="subtitle1"
                                sx={{ fontWeight: 700 }}
                            >
                                Import erfolgreich!
                            </Typography>
                            <Typography variant="body2">
                                <b>{result.count}</b> Datensätze von <b>{result.first}</b> bis <b>{result.last}</b>{' '}
                                wurden verarbeitet.
                            </Typography>
                        </Alert>
                    </Fade>
                )}
            </Box>
        </Fade>
    );
};

export default CSVImporter;

# Regression Runner Documentation

El sistema incluye un **Runner de Regresión** para validar y mejorar la precisión de la extracción de cantidades desde archivos DXF comparándolas con un CSV de validación (presupuesto base).

## Requisitos Previos

1.  **Git LFS**: El archivo DXF (`ACAD-LDS_PAK - (LC) Copia Clean.dxf`) es grande (~25MB) y está almacenado usando Git LFS.
    Asegúrate de descargarlo antes de correr las pruebas:
    ```bash
    git lfs pull
    ```
    Si el archivo pesa < 1KB, es solo un puntero y la regresión fallará.

2.  **Dependencias**: Instalar paquetes de Node.
    ```bash
    npm install
    ```

## Comandos

### 1. Ejecutar Regresión
Ejecuta el pipeline completo (Parsing DXF -> Matching -> Reporte) y compara los resultados contra el CSV.

```bash
npm run regression
```

*   **Entrada**: `00. LdS PA - Planilla cotizaciขn OOCC MV CONSTRUCTORA rev1.csv` (Validación) y el DXF.
*   **Salida**: `artifacts/regression_report.json` (Métricas y detalles por fila).

### 2. Rellenar XLSX Objetivo
Adicionalmente, se puede rellenar el archivo Excel de salida con las cantidades calculadas.

```bash
npm run fill-xlsx
```

*   **Entrada**: `00. LdS PAK - Planilla cotizaciขn OOCC.xlsx` (Archivo a rellenar).
*   **Acción**: Busca las filas correspondientes usando una llave normalizada (`partida|unidad`) y escribe la cantidad en la columna "Cantidad".
*   **Salida**: `artifacts/filled.xlsx` (Copia del original con datos rellenados). NO sobrescribe el original.

## Interpretación del Reporte (`regression_report.json`)

El reporte JSON contiene:

*   **summary**:
    *   `MAPE`: Error Porcentual Absoluto Medio (menor es mejor).
    *   `outliers`: Cantidad de filas con error > 10%.
*   **items**: Array con detalles por cada fila evaluada.
    *   `expectedQty`: Cantidad correcta según CSV.
    *   `predictedQty`: Cantidad extraída por el sistema.
    *   `matchedLayer`: Capa del DXF seleccionada.
    *   `flags`: Advertencias (e.g. `duplicate_key` si hay filas ambiguas en el XLSX, `unit_mismatch`, `small_area`).

## Notas Técnicas

*   **Normalización**: Las claves de búsqueda normalizan texto (minúsculas, sin tildes, sin puntuación) y unidades (e.g. "m2", "m²", "mt2" -> "m2").
*   **Items Globales (gl)**: Se asumen como cantidad 1 por defecto si no hay geometría específica, marcados como tipo `service`.
*   **Geometría**: Se priorizan HATCH (Áreas) para items `m2`. Si no existen, se intenta usar `Largo * Altura` (para muros) o la suma de áreas de la capa completa.
*   **Escala**: El sistema intenta detectar automáticamente la unidad del DXF. Si el BBox diagonal es inverosímil (< 1m), se intenta usar la geometría explotada de bloques.

## Solución de Problemas

*   **Error "DXF file seems too small"**: Corre `git lfs pull`.
*   **Error "Cannot find module"**: Corre `npm install`.
*   **Cantidades en 0**:
    *   Verifica si la capa correcta existe en el DXF.
    *   Verifica si la geometría es HATCH (para áreas) o LINE/POLYLINE (para longitudes).
    *   Revisa si el item fue clasificado correctamente (e.g. `service` vs `item`).

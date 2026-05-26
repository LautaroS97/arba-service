const express = require('express');
const bodyParser = require('body-parser');
const puppeteer = require('puppeteer');
const helmet = require('helmet');
const morgan = require('morgan');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 80;

app.use(helmet());
app.use(bodyParser.json());
app.use(morgan('combined'));
app.use(cors());
app.options('*', cors());

app.post('/fetch-arba-data', async (req, res) => {
    console.log('Received data:', req.body);
    const { lat, lng } = req.body;

    try {
        const { partidas, partido } = await fetchArbaData(lat, lng);

        if (!partidas || !partidas.length || !partido) {
            console.error('No se pudo obtener las partidas o el partido');
            return res.status(500).send({
                success: false,
                service: 'arba',
                message: 'No se pudo obtener las partidas o el partido',
                error: 'No se pudo obtener las partidas o el partido'
            });
        }

        const partidoNumeroMatch = partido.match(/Partido:\s*(\d+)/);
        const municipioMatch = partido.match(/\(([^)]+)\)/);

        if (!partidoNumeroMatch) {
            console.error('No se pudo extraer el número de partido.');
            return res.status(500).send({
                success: false,
                service: 'arba',
                message: 'No se pudo extraer el número de partido',
                error: 'No se pudo extraer el número de partido',
                partido_raw: partido
            });
        }

        const partidoNumero = partidoNumeroMatch[1];
        const municipio = municipioMatch ? municipioMatch[1] : '';

        console.log('Data fetched successfully:', {
            partidas: partidas.map(p => `${p.partida} (SP: ${p.sp})`),
            partido: partidoNumero,
            municipio
        });

        return res.send({
            success: true,
            service: 'arba',
            message: 'Datos ARBA obtenidos correctamente',
            partidas,
            partidas_simple: partidas.map(p => p.partida),
            partido: partidoNumero,
            municipio,
            partido_raw: partido,
            links: {
                consulta_deudas: 'https://app.arba.gov.ar/AvisoDeudas/?imp=0'
            }
        });
    } catch (error) {
        console.error('Error en el proceso:', error);
        return res.status(500).send({
            success: false,
            service: 'arba',
            message: 'Error procesando la solicitud',
            error: error.message || String(error)
        });
    }
});

async function fetchArbaData(lat, lng) {
    let browser;
    try {
        console.log('Launching Puppeteer...');
        browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
        const page = await browser.newPage();

        console.log('Navegando a la página de ARBA...');
        await page.goto('https://carto.arba.gov.ar/cartoArba/', { waitUntil: 'networkidle2' });
        await delay(1000);

        console.log('Modificando manejadores de eventos...');
        await page.evaluate(() => {
            document.querySelectorAll('*').forEach(el => {
                el.onclick = null;
                el.onmousedown = null;
            });
        });

        console.log('Esperando al botón de información...');
        let buttonActivated = await page.evaluate(() => {
            const button = document.querySelector('.olControlInfoButtonItemActive.olButton[title="Información"]');
            return button !== null;
        });

        if (!buttonActivated) {
            console.log('Botón no activado, activando...');
            await page.evaluate(() => {
                const button = document.querySelector('.olControlInfoButtonItemInactive.olButton[title="Información"]');
                if (button) {
                    button.style.pointerEvents = 'auto';
                    ['mousedown', 'mouseup', 'click'].forEach(event => {
                        button.dispatchEvent(new MouseEvent(event, {
                            bubbles: true,
                            cancelable: true,
                            view: window
                        }));
                    });
                }
            });

            await delay(1000);
            buttonActivated = await page.evaluate(() => {
                const button = document.querySelector('.olControlInfoButtonItemActive.olButton[title="Información"]');
                return button !== null;
            });

            if (!buttonActivated) {
                console.log('No se pudo activar el botón. Reintentando...');
            } else {
                console.log('Botón activado exitosamente.');
            }
        } else {
            console.log('Botón ya estaba activado.');
        }

        console.log(`Introduciendo coordenadas: ${lat}, ${lng}`);
        await page.type('#inputfindall', `${lat},${lng}`);

        console.log('Haciendo clic en la lista de sugerencias...');
        await page.waitForSelector('#ui-id-1', { visible: true, timeout: 30000 });
        await page.click('#ui-id-1');

        await delay(5000);

        console.log('Haciendo clic en el centro de la pantalla...');
        const dimensions = await page.evaluate(() => {
            return {
                width: document.documentElement.clientWidth,
                height: document.documentElement.clientHeight
            };
        });

        await page.mouse.click(dimensions.width / 2, dimensions.height / 2);
        await delay(10000);

        console.log('Esperando a que aparezca el contenedor de información...');
        await page.waitForSelector('.panel.curva.panel-info .panel-body div', { visible: true, timeout: 60000 });
        await delay(3000);

        console.log('Obteniendo todas las partidas de la tabla...');
        const partidas = await getAllPartidas(page);

        console.log('Partidas obtenidas:', partidas.map(p => `${p.partida}(SP:${p.sp})`).join(', '));

        console.log('Obteniendo datos del partido...');
        const partido = await page.evaluate(() => {
            const partidoDiv = Array.from(document.querySelectorAll('.panel.curva.panel-info .panel-body div'))
                .find(div => div.textContent.includes('Partido:'));
            return partidoDiv ? partidoDiv.textContent.trim() : 'No encontrado';
        });

        console.log('Datos del partido obtenidos:', partido);

        await browser.close();
        return { partidas, partido };
    } catch (error) {
        console.error('Error en Puppeteer:', error);
        if (browser) await browser.close();
        throw error;
    }
}

async function getAllPartidas(page) {
    try {
        await page.waitForSelector('.table-pager', { visible: true, timeout: 4000 });
    } catch (err) {
        console.log('No se encontró paginador (.table-pager). Asumimos 1 sola página.');
    }

    const totalPages = await page.evaluate(() => {
        const totalPagesEl = document.querySelector('.table-pager .total-pages');
        if (totalPagesEl) {
            return parseInt(totalPagesEl.textContent.trim(), 10);
        }
        return 1;
    });

    let allPartidas = [];
    for (let currentPage = 1; currentPage <= totalPages; currentPage++) {
        console.log(`Extrayendo filas de la página ${currentPage} de ${totalPages}...`);
        const filas = await extractTableRows(page);
        allPartidas = allPartidas.concat(filas);

        if (currentPage < totalPages) {
            console.log('Haciendo clic en botón "next-page"...');
            await page.evaluate(() => {
                const nextBtn = document.querySelector('.btn.btn-primary.btn-sm.next-page');
                if (nextBtn && !nextBtn.classList.contains('disabled')) {
                    nextBtn.click();
                }
            });

            await delay(2000);
        }
    }
    return allPartidas;
}

async function extractTableRows(page) {
    return page.evaluate(() => {
        const table = Array.from(document.querySelectorAll('table')).find(tbl =>
            Array.from(tbl.querySelectorAll('th')).some(th => th.textContent.includes('Partida'))
        );
        if (!table) {
            console.log('No se encontró la tabla con la columna "Partida".');
            return [];
        }
        const rows = table.querySelectorAll('tbody tr');
        return Array.from(rows).map(row => {
            const tds = row.querySelectorAll('td');
            return {
                partida: tds[0] ? tds[0].textContent.trim() : '',
                supTerreno: tds[1] ? tds[1].textContent.trim() : '',
                sp: tds[2] ? tds[2].textContent.trim() : ''
            };
        }).filter(row => row.partida);
    });
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const server = app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

server.setTimeout(300000);

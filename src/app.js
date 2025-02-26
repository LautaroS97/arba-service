const express = require('express');
const bodyParser = require('body-parser');
const puppeteer = require('puppeteer');
const nodemailer = require('nodemailer');
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
    const { lat, lng, email } = req.body;
    try {
        // Llamamos a la función que usa Puppeteer
        const { partidas, partido } = await fetchArbaData(lat, lng);

        if (partidas && partido) {
            // Extraemos número de partido y municipio del texto
            const partidoNumeroMatch = partido.match(/Partido:\s*(\d+)/);
            const municipioMatch = partido.match(/\(([^)]+)\)/);

            if (partidoNumeroMatch && municipioMatch) {
                const partidoNumero = partidoNumeroMatch[1];
                const municipio = municipioMatch[1];

                // Enviamos correo con la info
                await sendEmail(email, partidas, partidoNumero, municipio);
                console.log('Email sent with data:', { 
                    partidas: partidas.map(p => `${p.partida} (SP: ${p.sp})`),
                    partido: partidoNumero,
                    municipio
                });
                res.send({ 
                    message: 'Email enviado con éxito', 
                    partidas: partidas.map(p => p.partida), 
                    partido: partidoNumero 
                });
            } else {
                console.error('No se pudo extraer el número de partido o el municipio.');
                res.status(500).send({ error: 'No se pudo extraer el número de partido o el municipio.' });
            }
        } else {
            console.error('No se pudo obtener las partidas o el partido');
            res.status(500).send({ error: 'No se pudo obtener las partidas o el partido' });
        }
    } catch (error) {
        console.error('Error en el proceso:', error);
        res.status(500).send({ error: 'Error procesando la solicitud' });
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
        // Espera simple de 1 segundo
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

            await delay(1000); // Espera un poco
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

        // Esperamos unos segundos para que se ubique en el mapa
        await delay(5000);

        console.log('Haciendo clic en el centro de la pantalla...');
        let dimensions = await page.evaluate(() => {
            return {
                width: document.documentElement.clientWidth,
                height: document.documentElement.clientHeight
            };
        });

        let centerX = dimensions.width / 2;
        let centerY = dimensions.height / 2;
        await page.mouse.click(centerX, centerY);

        // Esperar a que cargue la info
        await delay(10000);

        console.log('Esperando a que aparezca el contenedor de información...');
        await page.waitForSelector('.panel.curva.panel-info .panel-body div', { visible: true, timeout: 60000 });

        // Esperamos un poco más por las dudas
        await delay(3000);

        // Aquí obtenemos todas las partidas (iterando cada página si hubiera)
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

        console.log('Cerrando el navegador...');
        await browser.close();
        return { partidas, partido };
    } catch (error) {
        console.error('Error en Puppeteer:', error);
        if (browser) await browser.close();
        throw error;
    }
}

/**
 * Itera por las páginas (si las hubiera) y retorna un array con todas las filas extraídas.
 */
async function getAllPartidas(page) {
    // Si la tabla no usa paginación, o solo hay 1 página, .table-pager podría no existir
    try {
        await page.waitForSelector('.table-pager', { visible: true, timeout: 4000 });
    } catch (err) {
        console.log('No se encontró paginador (.table-pager). Asumimos 1 sola página.');
    }

    // Obtener el total de páginas (si existe el elemento .total-pages)
    const totalPages = await page.evaluate(() => {
        const totalPagesEl = document.querySelector('.table-pager .total-pages');
        if (totalPagesEl) {
            return parseInt(totalPagesEl.textContent.trim(), 10);
        }
        return 1; // si no existe, 1 sola página
    });

    let allPartidas = [];
    for (let currentPage = 1; currentPage <= totalPages; currentPage++) {
        console.log(`Extrayendo filas de la página ${currentPage} de ${totalPages}...`);
        const filas = await extractTableRows(page);
        allPartidas = allPartidas.concat(filas);

        // Si no es la última página, clic en Next
        if (currentPage < totalPages) {
            console.log('Haciendo clic en botón "next-page"...');
            await page.evaluate(() => {
                const nextBtn = document.querySelector('.btn.btn-primary.btn-sm.next-page');
                if (nextBtn && !nextBtn.classList.contains('disabled')) {
                    nextBtn.click();
                }
            });

            // En entornos donde page.waitForTimeout no funciona, usamos un delay manual
            await delay(2000); 
        }
    }
    return allPartidas;
}

/**
 * Extrae (partida, sp, supTerreno) de la tabla en la página actual.
 */
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
        });
    });
}

/**
 * Envío de email con toda la información recolectada.
 */
async function sendEmail(email, partidas, partidoNumero, municipio) {
    let transporter = nodemailer.createTransport({
        host: "smtp-relay.brevo.com",
        port: 465,
        secure: true,
        auth: {
            user: process.env.BREVO_USER,
            pass: process.env.BREVO_PASS,
        },
        tls: {
            rejectUnauthorized: false
        },
        connectionTimeout: 5000,
        greetingTimeout: 5000,
        socketTimeout: 10000,
    });

    // Armamos el texto (HTML y texto plano) con el formato "103 - 75798 : Subparcela (PH) 6"
    const partidasFormattedHTML = partidas
      .map(obj => {
        return obj.sp
          ? `${partidoNumero} - ${obj.partida} : Subparcela (PH) ${obj.sp}`
          : `${partidoNumero} - ${obj.partida}`;
      })
      .join('<br>');

    const partidasFormattedText = partidas
      .map(obj => {
        return obj.sp
          ? `${partidoNumero} - ${obj.partida} : Subparcela (PH) ${obj.sp}`
          : `${partidoNumero} - ${obj.partida}`;
      })
      .join('\n');

    let mailOptions = {
        from: '"PROPROP" <ricardo@proprop.com.ar>',
        to: email,
        bcc: 'info@proprop.com.ar',
        subject: "Consulta de ARBA",
        text: `Partido/Partidas:\n${partidasFormattedText}\n(${municipio})\n\nTe llegó este correo porque solicitaste tu número de partida inmobiliaria al servicio de consultas de ProProp.`,
        html: `
            <div style="padding: 1rem; text-align: center;">
                <img src="https://proprop.com.ar/wp-content/uploads/2024/06/Logo-email.jpg" style="width: 100%; padding: 1rem;" alt="Logo PROPROP">
                <p>Partido/Partidas:<br><b>${partidasFormattedHTML}</b><br>(${municipio})</p><hr>
                <p>Puede utilizar esta información para consultar sus deudas en ARBA desde este <a href="https://app.arba.gov.ar/AvisoDeudas/?imp=0">link</a>.</p>
                <img src="https://proprop.com.ar/wp-content/uploads/2024/06/20240619_194805-min.jpg" style="width: 100%; padding: 1rem;" alt="Logo PROPROP">
                <p style="margin-top: 1rem; font-size: 0.8rem; font-style: italic;">Te llegó este correo porque solicitaste tu número de partida inmobiliaria al servicio de consultas de ProProp.</p>
                <p style="margin-top: 1rem; font-size: 0.8rem; font-style: italic;"><b>Ante cualquier duda, puede responder este correo.</b></p>
            </div>
        `
    };

    try {
        let info = await transporter.sendMail(mailOptions);
        console.log('Message sent: %s', info.messageId);
    } catch (error) {
        console.error('Error enviando email:', error);
        throw error;
    }
}

// Simple helper para "esperar X ms" sin usar page.waitForTimeout
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const server = app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

// Ajustar timeout si fuera necesario
server.setTimeout(10000);
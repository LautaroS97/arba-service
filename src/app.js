<<<<<<< HEAD
require('dotenv').config();

=======
>>>>>>> d8fad61 (ARBA 1.04)
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
        const { partidas, partido } = await fetchArbaData(lat, lng);
        if (partidas && partido) {
            const partidoNumeroMatch = partido.match(/Partido:\s*(\d+)/);
            const municipioMatch = partido.match(/\(([^)]+)\)/);

            if (partidoNumeroMatch && municipioMatch) {
                const partidoNumero = partidoNumeroMatch[1]; // Extraer el número de partido
                const municipio = municipioMatch[1]; // Extraer el municipio del partido
                await sendEmail(email, partidas, partidoNumero, municipio);
                console.log('Email sent with data:', { partidas, partido: partidoNumero, municipio });
                res.send({ message: 'Email enviado con éxito', partidas: partidas, partido: partidoNumero });
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
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
        const page = await browser.newPage();

        console.log('Navegando a la página de ARBA...');
        await page.goto('https://carto.arba.gov.ar/cartoArba/', { waitUntil: 'networkidle2' });

<<<<<<< HEAD
=======
        // Esperar un poco para que cargue la página base
>>>>>>> d8fad61 (ARBA 1.04)
        await new Promise(resolve => setTimeout(resolve, 1000));

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

            await new Promise(resolve => setTimeout(resolve, 1000));

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

<<<<<<< HEAD
=======
        // Esperar para que la página procese la búsqueda y se posicione en el mapa
>>>>>>> d8fad61 (ARBA 1.04)
        await new Promise(resolve => setTimeout(resolve, 5000));

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

<<<<<<< HEAD
=======
        // Esperar para que aparezca la información en la parte inferior
>>>>>>> d8fad61 (ARBA 1.04)
        await new Promise(resolve => setTimeout(resolve, 10000));

        console.log('Esperando a que aparezca el contenedor de información...');
        await page.waitForSelector('.panel.curva.panel-info .panel-body div', { visible: true, timeout: 60000 });

<<<<<<< HEAD
        await new Promise(resolve => setTimeout(resolve, 3000));

        console.log('Obteniendo todos los números de partida...');
        const partidas = await page.evaluate(() => {
            const table = Array.from(document.querySelectorAll('table')).find(table => {
                return Array.from(table.querySelectorAll('th')).some(th => th.textContent.includes('Partida'));
            });
            
            if (table) {
                console.log('Tabla encontrada, extrayendo filas...');
                const row = table.querySelector('tbody tr');
                const partida = row ? row.querySelector('td').textContent.trim() : null;
                return partida ? [partida] : [];
            } else {
                console.log('No se encontró la tabla con la columna "Partida"');
                return [];
            }
=======
        // Esperar un poco más para asegurar que toda la información se cargue
        await new Promise(resolve => setTimeout(resolve, 3000));

        /**
         * Aumentar el número de filas mostradas (por ejemplo, a 50)
         * para capturar todas las partidas sin cambiar de página.
         */
        console.log('Configurando la paginación para mostrar 50 filas (si está disponible)...');
        try {
            await page.waitForSelector('.page-size', { visible: true, timeout: 3000 });
            await page.click('.page-size');
            await page.waitForSelector('.page-size-options', { visible: true, timeout: 3000 });
            await page.evaluate(() => {
                const option = Array.from(document.querySelectorAll('.page-size-options li a'))
                    .find(a => a.innerText.trim() === '50');
                if (option) {
                    option.click();
                }
            });
            // Esperar a que la tabla se recargue con la nueva cantidad de filas
            await new Promise(resolve => setTimeout(resolve, 3000));
        } catch (e) {
            console.log('No se encontró la opción de paginación o no se pudo seleccionar 50. Continuando...');
        }

        /**
         * Extraer TODAS las partidas recorriendo todas las filas de la tabla.
         */
        console.log('Obteniendo todos los números de partida...');
        const partidas = await page.evaluate(() => {
            // 1. Buscar la tabla que tenga en sus <th> la palabra “Partida”
            const table = Array.from(document.querySelectorAll('table')).find(tbl =>
                Array.from(tbl.querySelectorAll('th')).some(th => th.textContent.includes('Partida'))
            );

            if (!table) {
                console.log('No se encontró la tabla con columna "Partida".');
                return [];
            }

            // 2. Seleccionar todas las filas del <tbody>
            const rows = table.querySelectorAll('tbody tr');

            // 3. Recorrer cada fila y extraer el valor de la celda que contenga la partida
            return Array.from(rows).map(row => {
                const td = row.querySelector('td');
                return td ? td.innerText.trim() : null;
            }).filter(Boolean);
>>>>>>> d8fad61 (ARBA 1.04)
        });

        console.log(`Partidas obtenidas: ${partidas.join(', ')}`);

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

    let partidasFormatted = partidas.length > 1
        ? partidas.map(partida => `${partidoNumero} - ${partida}`).join('<br>')
        : `${partidoNumero} - ${partidas[0]}`;

    let textPartidas = partidas.length > 1
        ? partidas.map(partida => `${partidoNumero} - ${partida}`).join('\n')
        : `${partidoNumero} - ${partidas[0]}`;

    let mailOptions = {
        from: '"PROPROP" <ricardo@proprop.com.ar>',
        to: email,
        bcc: 'info@proprop.com.ar',
        subject: "Consulta de ARBA",
        text: `Partido/Partidas:\n${textPartidas}\n(${municipio})\n\nTe llegó este correo porque solicitaste tu número de partida inmobiliaria al servicio de consultas de ProProp.`,
        html: `
            <div style="padding: 1rem; text-align: center;">
                <img src="https://proprop.com.ar/wp-content/uploads/2024/06/Logo-email.jpg" style="width: 100%; padding: 1rem;" alt="Logo PROPROP">
                <p>Partido/Partidas:<br><b>${partidasFormatted}</b><br>(${municipio})</p><hr>
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

const server = app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

<<<<<<< HEAD
=======
// Ajustar el timeout del servidor si fuera necesario
>>>>>>> d8fad61 (ARBA 1.04)
server.setTimeout(10000);
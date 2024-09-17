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
            const partidoNumero = partido.match(/Partido:\s*(\d+)/)[1]; // Extraer el número de partido
            const municipio = partido.match(/\(([^)]+)\)/)[1]; // Extraer el municipio del partido
            await sendEmail(email, partidas, partidoNumero, municipio);
            console.log('Email sent with data:', { partidas, partido: partidoNumero, municipio });
            res.send({ message: 'Email enviado con éxito', partidas: partidas, partido: partidoNumero });
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
            headless: 'new', // Usar la nueva implementación de headless
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
        const page = await browser.newPage();

        console.log('Navegando a la página de ARBA...');
        await page.goto('https://carto.arba.gov.ar/cartoArba/', { waitUntil: 'networkidle2' });

        await new Promise(resolve => setTimeout(resolve, 1000));

        console.log('Modificando manejadores de eventos...');
        await page.evaluate(() => {
            document.querySelectorAll('*').forEach(el => {
                el.onclick = null;
                el.onmousedown = null;
            });
        });

        console.log('Esperando al botón de información...');
        await page.waitForSelector('.olControlInfoButtonItemInactive.olButton[title="Información"]', { visible: true });

        let buttonActivated = false;
        while (!buttonActivated) {
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

            await new Promise(resolve => setTimeout(resolve, 1000)); // Esperar un momento para verificar el estado

            buttonActivated = await page.evaluate(() => {
                const button = document.querySelector('.olControlInfoButtonItemActive.olButton[title="Información"]');
                return button !== null;
            });

            if (!buttonActivated) {
                console.log('Botón no activado, intentando nuevamente...');
            }
        }

        console.log(`Introduciendo coordenadas: ${lat}, ${lng}`);
        await page.type('#inputfindall', `${lat},${lng}`);

        console.log('Haciendo clic en la lista de sugerencias...');
        await page.waitForSelector('#ui-id-1', { visible: true, timeout: 30000 });
        await page.click('#ui-id-1');

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

        await new Promise(resolve => setTimeout(resolve, 10000));

        // Asegurarse de que el botón sigue activo
        buttonActivated = await page.evaluate(() => {
            const button = document.querySelector('.olControlInfoButtonItemActive.olButton[title="Información"]');
            return button !== null;
        });

        if (!buttonActivated) {
            console.log('El botón se ha desactivado, intentando reactivarlo...');
            while (!buttonActivated) {
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

                await new Promise(resolve => setTimeout(resolve, 1000)); // Esperar un momento para verificar el estado

                buttonActivated = await page.evaluate(() => {
                    const button = document.querySelector('.olControlInfoButtonItemActive.olButton[title="Información"]');
                    return button !== null;
                });

                if (!buttonActivated) {
                    console.log('Botón no activado, intentando nuevamente...');
                } else {
                    console.log('Haciendo clic en el centro de la pantalla nuevamente...');
                    dimensions = await page.evaluate(() => {
                        return {
                            width: document.documentElement.clientWidth,
                            height: document.documentElement.clientHeight
                        };
                    });

                    centerX = dimensions.width / 2;
                    centerY = dimensions.height / 2;
                    await page.mouse.click(centerX, centerY);

                    await new Promise(resolve => setTimeout(resolve, 10000));
                }
            }
        }

        console.log('Esperando a que aparezca el contenedor de información...');
        await page.waitForSelector('.panel.curva.panel-info .panel-body div', { visible: true, timeout: 60000 });

        console.log('Obteniendo todos los números de partida...');
        const partidas = await page.evaluate(() => {
            const rows = document.querySelectorAll('#tableinfo3 tbody tr');
            return Array.from(rows).map(row => row.querySelector('td').textContent.trim());
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
            user: "eabu72@gmail.com",
            pass: "9VtU5jOsXpNK6hm1"
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
                <p>Puede utilizar esta información para consultar sus deudas en ARBA desde este <a href="https://app.arba.gov.ar/AvisoDeudas/?imp=0">link<a>.</p>
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

server.setTimeout(10000);
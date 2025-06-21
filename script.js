// Importações modulares do Firebase SDK (versão 9+)
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js";
import { getFirestore, collection, addDoc, doc, deleteDoc, query, orderBy, onSnapshot } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-analytics.js";

// Variáveis do módulo
let firebaseApp = null;
let db = null;
let auth = null;
let analytics = null;
let currentUserId = null; // Para armazenar o UID do usuário autenticado
let isFirebaseInitialized = false; // Flag para controlar a inicialização

document.addEventListener('DOMContentLoaded', async () => {
    // Tenta obter a configuração do Firebase do ambiente (se existir)
    const firebaseConfig = typeof window.__firebase_config !== 'undefined'
        ? JSON.parse(window.__firebase_config)
        : null; // Use null se não houver configuração injetada

    // O appId para as coleções do Firestore será o projectId (se a config estiver disponível)
    const currentAppId = firebaseConfig && firebaseConfig.projectId
        ? firebaseConfig.projectId
        : 'default-app-id'; // Fallback para GitHub Pages sem config

    try {
        if (firebaseConfig && firebaseConfig.apiKey) { // Só tenta inicializar se houver uma API Key
            console.log("Inicializando Firebase com Firebase SDK v9+...");
            console.log("Firebase Config:", firebaseConfig);
            console.log("App ID (para Firestore paths):", currentAppId);

            firebaseApp = initializeApp(firebaseConfig);
            auth = getAuth(firebaseApp);
            db = getFirestore(firebaseApp);
            analytics = getAnalytics(firebaseApp); // Inicializa o Analytics

            isFirebaseInitialized = true;
            console.log("Firebase inicializado com sucesso.");

            onAuthStateChanged(auth, async (user) => {
                if (user) {
                    currentUserId = user.uid;
                    console.log("Usuário autenticado:", user.uid);
                } else {
                    console.log("Usuário não autenticado, tentando autenticação anônima...");
                    try {
                        const injectedAuthToken = typeof window.__initial_auth_token !== 'undefined' ? window.__initial_auth_token : null;
                        if (injectedAuthToken) {
                            await signInWithCustomToken(auth, injectedAuthToken);
                        } else {
                            await signInAnonymously(auth);
                        }
                        currentUserId = auth.currentUser ? auth.currentUser.uid : crypto.randomUUID();
                        console.log("Autenticação anônima/com token concluída. Usuário:", currentUserId);
                    } catch (error) {
                        console.error("Erro na autenticação:", error);
                        currentUserId = crypto.randomUUID(); // Fallback
                        console.warn("Autenticação falhou. Usando ID de usuário gerado localmente:", currentUserId);
                    }
                }

                const userIdDisplayElement = document.getElementById('userIdDisplay');
                if (userIdDisplayElement) {
                    userIdDisplayElement.textContent = `ID do Usuário: ${currentUserId}`;
                }
                // Carregar histórico após autenticação
                if (currentUserId && isFirebaseInitialized) { // Garante que o Firebase está pronto
                    window.loadSludgeAgeHistory(currentAppId);
                    window.loadPhysicalChemicalHistory(currentAppId);
                    window.loadOrganicLoadHistory(currentAppId);
                }
            });
        } else {
            console.warn("Configuração do Firebase não encontrada. As funcionalidades de banco de dados não estarão disponíveis.");
            document.getElementById('userIdDisplay').textContent = `ID do Usuário: Funcionalidades de DB inativas (sem config Firebase).`;
            currentUserId = crypto.randomUUID(); // ID temporário para UI
        }

    } catch (e) {
        console.error("Erro ao inicializar Firebase ou script DOMContentLoaded:", e);
        const userIdDisplayElement = document.getElementById('userIdDisplay');
        if (userIdDisplayElement) {
            userIdDisplayElement.textContent = `ID do Usuário: Erro ao carregar`;
        }
        currentUserId = crypto.randomUUID(); // Fallback
        console.warn("Firebase ou DOMContentLoaded falhou. Usando ID de usuário gerado localmente:", currentUserId);
    }

    // --- Funções de Ajuda, Cálculo e Salvar (mantidas no âmbito global para acessibilidade) ---

    // Helper function to determine the color class for results
    window.getResultColorClass = function(value, type) {
        switch (type) {
            case 'sludgeAge':
                if (value >= 5 && value <= 15) { return 'result-positive'; }
                else if (value > 15 && value <= 20) { return 'result-warning'; }
                else if (value < 5 && value >= 0) { return 'result-warning'; }
                else { return 'result-negative'; }
            case 'efficiency':
                if (value >= 80) { return 'result-positive'; }
                else if (value >= 60) { return 'result-warning'; }
                else if (value >= 0) { return 'result-negative'; }
                else { return ''; }
            case 'dosage': return '';
            case 'organicLoad': return '';
            default: return '';
        }
    };

    // --- Funções de Manipulação de Dados (Firestore) ---
    window.saveData = async function(collectionName, data, appId) {
        if (!isFirebaseInitialized || !db || !currentUserId || !appId) {
            console.error("Firestore não inicializado ou ID do usuário/appId não disponível. Não foi possível salvar os dados.");
            return;
        }
        try {
            const docRef = await addDoc(collection(db, `artifacts/${appId}/users/${currentUserId}/${collectionName}`), {
                ...data,
                timestamp: new Date()
            });
            console.log("Documento salvo com ID: ", docRef.id);
            return docRef.id;
        } catch (e) {
            console.error("Erro ao adicionar documento: ", e);
        }
    };

    window.setupHistoryListener = function(collectionName, historyDisplayId, loadFunction, appId) {
        if (!isFirebaseInitialized || !db || !currentUserId || !appId) {
            console.warn(`Firestore não inicializado ou ID do usuário/appId não disponível. Não foi possível carregar o histórico para ${collectionName}.`);
            const historyElement = document.getElementById(historyDisplayId);
            if (historyElement) {
                historyElement.innerHTML = `<p class="text-center text-gray-500">Funcionalidades de base de dados inativas (sem config Firebase).</p>`;
            }
            return;
        }

        const q = query(collection(db, `artifacts/${appId}/users/${currentUserId}/${collectionName}`), orderBy("timestamp", "desc"));

        onSnapshot(q, (snapshot) => {
            const historyData = [];
            snapshot.forEach((doc) => {
                historyData.push({ id: doc.id, ...doc.data() });
            });
            window.displayHistory(historyDisplayId, historyData, loadFunction, collectionName, appId);
        }, (error) => {
            console.error(`Erro ao ouvir mudanças em ${collectionName}:`, error);
            const historyElement = document.getElementById(historyDisplayId);
            if (historyElement) {
                historyElement.innerHTML = `<p class="text-center text-red-500">Erro ao carregar histórico: ${error.message}</p>`;
            }
        });
    };

    window.displayHistory = function(displayElementId, data, loadFunction, collectionName, appId) {
        const displayElement = document.getElementById(displayElementId);
        if (!displayElement) return;

        if (data.length === 0) {
            displayElement.innerHTML = `<p class="text-center text-gray-500">Nenhum cálculo salvo ainda.</p>`;
            return;
        }

        let tableHtml = `
            <table class="min-w-full divide-y divide-gray-200">
                <thead class="bg-gray-50">
                    <tr>
                        <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Data</th>
                        ${collectionName === 'sludgeAgeCalculations' ?
                            `<th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ISR (dias)</th>` : ''}
                        ${collectionName === 'physicalChemicalCalculations' ?
                            `<th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Eficiência Turb. (%)</th>
                             <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Eficiência Cor (%)</th>` : ''}
                        ${collectionName === 'organicLoadCalculations' ?
                            `<th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Carga Aflu. (kg/dia)</th>
                             <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Eficiência (%)</th>` : ''}
                        <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Ações</th>
                    </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-200">
        `;

        data.forEach(entry => {
            const date = entry.timestamp ? new Date(entry.timestamp.toDate()).toLocaleString() : 'N/A';
            tableHtml += `
                <tr class="hover:bg-gray-100">
                    <td class="px-3 py-2 whitespace-nowrap text-sm text-gray-900">${date}</td>
                    ${collectionName === 'sludgeAgeCalculations' ?
                        `<td class="px-3 py-2 whitespace-nowrap text-sm text-gray-900">${entry.calculatedISR ? entry.calculatedISR.toFixed(2) + ' dias' : 'N/A'}</td>` : ''}
                    ${collectionName === 'physicalChemicalCalculations' ?
                        `<td class="px-3 py-2 whitespace-nowrap text-sm text-gray-900">${entry.turbidityEfficiency ? entry.turbidityEfficiency.toFixed(2) + ' %' : 'N/A'}</td>
                         <td class="px-3 py-2 whitespace-nowrap text-sm text-gray-900">${entry.colorEfficiency ? entry.colorEfficiency.toFixed(2) + ' %' : 'N/A'}</td>` : ''}
                    ${collectionName === 'organicLoadCalculations' ?
                        `<td class="px-3 py-2 whitespace-nowrap text-sm text-gray-900">${entry.influentLoad ? entry.influentLoad.toFixed(2) + ' kg/dia' : 'N/A'}</td>
                         <td class="px-3 py-2 whitespace-nowrap text-sm text-gray-900">${entry.efficiency ? entry.efficiency.toFixed(2) + ' %' : 'N/A'}</td>` : ''}
                    <td class="px-3 py-2 whitespace-nowrap text-right text-sm font-medium flex gap-2">
                        <button data-id="${entry.id}" class="text-indigo-600 hover:text-indigo-900 load-btn">Carregar</button>
                        <button data-id="${entry.id}" class="text-red-600 hover:text-red-900 delete-btn">Excluir</button>
                    </td>
                </tr>
            `;
        });
        tableHtml += `
                </tbody>
            </table>
        `;
        displayElement.innerHTML = tableHtml;

        displayElement.querySelectorAll('.load-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const id = e.target.dataset.id;
                const entryToLoad = data.find(item => item.id === id);
                if (entryToLoad) {
                    loadFunction(entryToLoad);
                }
            });
        });

        displayElement.querySelectorAll('.delete-btn').forEach(button => {
            button.addEventListener('click', async (e) => {
                const id = e.target.dataset.id;
                console.warn(`Ação de exclusão: Tentando apagar documento com ID ${id} da coleção ${collectionName}.`);
                try {
                    if (db && currentUserId && appId) {
                       await deleteDoc(doc(db, `artifacts/${appId}/users/${currentUserId}/${collectionName}`, id));
                       console.log("Documento excluído com sucesso!");
                    } else {
                       console.error("Firestore não inicializado ou ID do usuário/appId não disponível. Não foi possível excluir o documento.");
                    }
                } catch (e) {
                    console.error("Erro ao excluir documento: ", e);
                }
            });
        });
    };

    window.loadSludgeAgeHistory = function(appId) {
        window.setupHistoryListener('sludgeAgeCalculations', 'sludgeAgeHistory', (entry) => {
            document.getElementById('aerationTankVolume').value = entry.aerationTankVolume || '';
            document.getElementById('aerationTankVSS').value = entry.aerationTankVSS || '';
            document.getElementById('discardFlowRate').value = entry.discardFlowRate || '';
            document.getElementById('discardVSS').value = entry.discardVSS || '';
            document.getElementById('effluentFlowRate').value = entry.effluentFlowRate || '';
            document.getElementById('effluentVSS').value = entry.effluentVSS || '';
            window.calculateSludgeAge();
        }, appId);
    };

    window.loadPhysicalChemicalHistory = function(appId) {
        window.setupHistoryListener('physicalChemicalCalculations', 'physicalChemicalHistory', (entry) => {
            document.getElementById('phyChemInitialTurbidity').value = entry.initialTurbidity || '';
            document.getElementById('phyChemFinalTurbidity').value = entry.finalTurbidity || '';
            document.getElementById('phyChemInitialColor').value = entry.initialColor || '';
            document.getElementById('phyChemFinalColor').value = entry.finalColor || '';
            document.getElementById('phyChemIdealDosage').value = entry.idealDosage || '';
            document.getElementById('phyChemDosageUnit').value = entry.dosageUnit || 'mg/L';
            document.getElementById('phyChemEtaFlowRate').value = entry.etaFlowRate || '';
            window.calculatePhysicalChemicalEfficiency();
        }, appId);
    };

    window.loadOrganicLoadHistory = function(appId) {
        window.setupHistoryListener('organicLoadCalculations', 'organicLoadHistory', (entry) => {
            document.getElementById('organicInfluentConcentration').value = entry.influentConcentration || '';
            document.getElementById('organicEffluentConcentration').value = entry.effluentConcentration || '';
            document.getElementById('organicLoadFlowRate').value = entry.flowRate || '';
            window.calculateOrganicLoad();
        }, appId);
    };


    // --- Funções de Cálculo (Modificadas para Salvar) ---
    window.calculateSludgeAge = async function() {
        const aerationTankVolumeInput = document.getElementById('aerationTankVolume');
        const aerationTankVSSInput = document.getElementById('aerationTankVSS');
        const discardFlowRateInput = document.getElementById('discardFlowRate');
        const discardVSSInput = document.getElementById('discardVSS');
        const effluentFlowRateInput = document.getElementById('effluentFlowRate');
        const effluentVSSInput = document.getElementById('effluentVSS');

        const errorDisplay = document.getElementById('errorDisplay');
        const resultDisplay = document.getElementById('resultDisplay');
        const sludgeAgeResultSpan = document.getElementById('sludgeAgeResult');

        if (errorDisplay) errorDisplay.classList.add('hidden');
        if (resultDisplay) resultDisplay.classList.add('hidden');
        if (errorDisplay) errorDisplay.textContent = '';
        if (sludgeAgeResultSpan) {
            sludgeAgeResultSpan.textContent = '';
            sludgeAgeResultSpan.className = 'text-2xl font-bold mt-2';
        }

        const inputs = {
            aerationTankVolume: parseFloat(aerationTankVolumeInput ? aerationTankVolumeInput.value : NaN),
            aerationTankVSS: parseFloat(aerationTankVSSInput ? aerationTankVSSInput.value : NaN),
            discardFlowRate: parseFloat(discardFlowRateInput ? discardFlowRateInput.value : NaN),
            discardVSS: parseFloat(discardVSSInput ? discardVSSInput.value : NaN),
            effluentFlowRate: parseFloat(effluentFlowRateInput ? effluentFlowRateInput.value : NaN),
            effluentVSS: parseFloat(effluentVSSInput ? effluentVSSInput.value : NaN),
        };

        for (const key in inputs) {
            if (isNaN(inputs[key]) || inputs[key] < 0) {
                if (errorDisplay) {
                    errorDisplay.textContent = 'Por favor, preencha todos os campos com valores numéricos positivos válidos.';
                    errorDisplay.classList.remove('hidden');
                }
                return;
            }
        }

        const V_aerationTank_L = inputs.aerationTankVolume * 1000;
        const Q_effluent_L_day = inputs.effluentFlowRate * 1000;

        const MINUTES_IN_DAY = 1440;
        const Q_discard_L_day = inputs.discardFlowRate * MINUTES_IN_DAY;

        const totalVSSMassAerationTank = V_aerationTank_L * inputs.aerationTankVSS;
        const totalVSSMassDiscardedDaily = Q_discard_L_day * inputs.discardVSS;
        const totalVSSMassInEffluentDaily = Q_effluent_L_day * inputs.effluentVSS;

        const denominator = totalVSSMassDiscardedDaily + totalVSSMassInEffluentDaily;

        if (denominator === 0) {
            if (errorDisplay) {
                errorDisplay.textContent = 'A soma das massas de SSV descartadas e no efluente é zero. Verifique os valores de entrada.';
                errorDisplay.classList.remove('hidden');
            }
            return;
        }

        const calculatedISR = totalVSSMassAerationTank / denominator;
        if (sludgeAgeResultSpan) {
            sludgeAgeResultSpan.textContent = calculatedISR.toFixed(2) + ' dias';
            sludgeAgeResultSpan.classList.add(window.getResultColorClass(calculatedISR, 'sludgeAge'));
        }
        if (resultDisplay) resultDisplay.classList.remove('hidden');

        const dataToSave = { ...inputs, calculatedISR: calculatedISR };
        return dataToSave;
    };

    window.calculatePhysicalChemicalEfficiency = async function() {
        const initialTurbidityInput = document.getElementById('phyChemInitialTurbidity');
        const finalTurbidityInput = document.getElementById('phyChemFinalTurbidity');
        const initialColorInput = document.getElementById('phyChemInitialColor');
        const finalColorInput = document.getElementById('phyChemFinalColor');
        const idealDosageInput = document.getElementById('phyChemIdealDosage');
        const dosageUnitSelect = document.getElementById('phyChemDosageUnit');
        const etaFlowRateInput = document.getElementById('phyChemEtaFlowRate');

        const initialTurbidity = parseFloat(initialTurbidityInput ? initialTurbidityInput.value : NaN);
        const finalTurbidity = parseFloat(finalTurbidityInput ? finalTurbidityInput.value : NaN);
        const initialColor = parseFloat(initialColorInput ? initialColorInput.value : NaN);
        const finalColor = parseFloat(finalColorInput ? finalColorInput.value : NaN);
        const idealDosage = parseFloat(idealDosageInput ? idealDosageInput.value : NaN);
        const dosageUnit = dosageUnitSelect ? dosageUnitSelect.value : '';
        const etaFlowRate = parseFloat(etaFlowRateInput ? etaFlowRateInput.value : NaN);

        const errorMessageDiv = document.getElementById('phyChemErrorDisplay');
        const resultDisplayDiv = document.getElementById('phyChemResultDisplay');
        if (errorMessageDiv) errorMessageDiv.classList.add('hidden');
        if (resultDisplayDiv) resultDisplayDiv.classList.add('hidden');

        const turbidityEfficiencySpan = document.getElementById('phyChemTurbidityEfficiency');
        const colorEfficiencySpan = document.getElementById('phyChemColorEfficiency');
        const dailyDosageSpan = document.getElementById('phyChemDailyDosage');

        if (turbidityEfficiencySpan) turbidityEfficiencySpan.className = 'font-semibold text-green-700';
        if (colorEfficiencySpan) colorEfficiencySpan.className = 'font-semibold text-green-700';
        if (dailyDosageSpan) dailyDosageSpan.className = 'font-semibold text-green-700';

        if (isNaN(initialTurbidity) || isNaN(finalTurbidity) || isNaN(initialColor) || isNaN(finalColor) ||
            isNaN(idealDosage) || isNaN(etaFlowRate) ||
            initialTurbidity < 0 || finalTurbidity < 0 || initialColor < 0 || finalColor < 0 ||
            idealDosage < 0 || etaFlowRate < 0) {
            if (errorMessageDiv) {
                errorMessageDiv.textContent = 'Por favor, preencha todos os campos com valores numéricos válidos e não negativos.';
                errorMessageDiv.classList.remove('hidden');
            }
            if (turbidityEfficiencySpan) turbidityEfficiencySpan.textContent = '-- %';
            if (colorEfficiencySpan) colorEfficiencySpan.textContent = '-- %';
            if (dailyDosageSpan) dailyDosageSpan.textContent = '--';
            return;
        }

        if (finalTurbidity > initialTurbidity) {
            if (errorMessageDiv) {
                errorMessageDiv.textContent = 'A turbidez final não pode ser maior que a turbidez inicial.';
                errorMessageDiv.classList.remove('hidden');
            }
            return;
        }
        if (finalColor > initialColor) {
            if (errorMessageDiv) {
                errorMessageDiv.textContent = 'A cor final não pode ser maior que a cor inicial.';
                errorMessageDiv.classList.remove('hidden');
            }
            return;
        }

        let turbidityEfficiency = 0;
        if (initialTurbidity > 0) {
            turbidityEfficiency = ((initialTurbidity - finalTurbidity) / initialTurbidity) * 100;
        } else if (initialTurbidity === 0 && finalTurbidity === 0) {
            turbidityEfficiency = 100;
        }

        let colorEfficiency = 0;
        if (initialColor > 0) {
            colorEfficiency = ((initialColor - finalColor) / initialColor) * 100;
        } else if (initialColor === 0 && finalColor === 0) {
             colorEfficiency = 100;
        }

        let dailyDosage;
        let dailyDosageUnit;
        if (dosageUnit === 'mg/L') {
            dailyDosage = (idealDosage * etaFlowRate) / 1000; // Result in kg/dia
            dailyDosageUnit = 'kg/dia';
        } else { // mL/L
            dailyDosage = idealDosage * etaFlowRate; // Result in L/dia
            dailyDosageUnit = 'L/dia';
        }

        if (turbidityEfficiencySpan) turbidityEfficiencySpan.textContent = `${turbidityEfficiency.toFixed(2)} %`;
        if (colorEfficiencySpan) colorEfficiencySpan.textContent = `${colorEfficiency.toFixed(2)} %`;
        if (dailyDosageSpan) dailyDosageSpan.textContent = `${dailyDosage.toFixed(2)} ${dailyDosageUnit}`;

        if (turbidityEfficiencySpan) turbidityEfficiencySpan.classList.add(window.getResultColorClass(turbidityEfficiency, 'efficiency'));
        if (colorEfficiencySpan) colorEfficiencySpan.classList.add(window.getResultColorClass(colorEfficiency, 'efficiency'));
        if (dailyDosageSpan) dailyDosageSpan.classList.add(window.getResultColorClass(0, 'dosage'));

        if (resultDisplayDiv) resultDisplayDiv.classList.remove('hidden');

        const dataToSave = {
            initialTurbidity, finalTurbidity, initialColor, finalColor,
            idealDosage, dosageUnit, etaFlowRate,
            turbidityEfficiency, colorEfficiency, dailyDosage, dailyDosageUnit
        };
        return dataToSave;
    };

    window.calculateOrganicLoad = async function() {
        const influentConcentrationInput = document.getElementById('organicInfluentConcentration');
        const effluentConcentrationInput = document.getElementById('organicEffluentConcentration');
        const flowRateInput = document.getElementById('organicLoadFlowRate');

        const influentConcentration = parseFloat(influentConcentrationInput ? influentConcentrationInput.value : NaN);
        const effluentConcentration = parseFloat(effluentConcentrationInput ? effluentConcentrationInput.value : NaN);
        const flowRate = parseFloat(flowRateInput ? flowRateInput.value : NaN);

        const errorMessageDiv = document.getElementById('organicLoadErrorDisplay');
        const resultDisplayDiv = document.getElementById('organicLoadResultDisplay');

        if (errorMessageDiv) errorMessageDiv.classList.add('hidden');
        if (resultDisplayDiv) resultDisplayDiv.classList.add('hidden');
        if (errorMessageDiv) errorMessageDiv.textContent = '';
        
        const influentLoadSpan = document.getElementById('influentOrganicLoadResult');
        const effluentLoadSpan = document.getElementById('effluentOrganicLoadResult');
        const efficiencyLoadSpan = document.getElementById('organicLoadEfficiencyResult');

        if (influentLoadSpan) influentLoadSpan.className = 'font-semibold text-green-700';
        if (effluentLoadSpan) effluentLoadSpan.className = 'font-semibold text-green-700';
        if (efficiencyLoadSpan) efficiencyLoadSpan.className = 'font-semibold text-green-700';

        if (influentLoadSpan) influentLoadSpan.textContent = '-- kg/dia';
        if (effluentLoadSpan) effluentLoadSpan.textContent = '-- kg/dia';
        if (efficiencyLoadSpan) efficiencyLoadSpan.textContent = '-- %';

        if (isNaN(influentConcentration) || isNaN(effluentConcentration) || isNaN(flowRate) ||
            influentConcentration < 0 || effluentConcentration < 0 || flowRate < 0) {
            if (errorMessageDiv) {
                errorMessageDiv.textContent = 'Por favor, preencha todos os campos com valores numéricos válidos e não negativos.';
                errorMessageDiv.classList.remove('hidden');
            }
            return;
        }

        if (effluentConcentration > influentConcentration) {
            if (errorMessageDiv) {
                errorMessageDiv.textContent = 'A concentração efluente não pode ser maior que a concentração afluente.';
                errorMessageDiv.classList.remove('hidden');
            }
            return;
        }

        const influentLoad = (influentConcentration * flowRate) / 1000;
        const effluentLoad = (effluentConcentration * flowRate) / 1000;

        let efficiency = 0;
        if (influentLoad > 0) {
            efficiency = ((influentLoad - effluentLoad) / influentLoad) * 100;
        } else if (influentLoad === 0 && effluentLoad === 0) {
            efficiency = 100;
        }

        if (influentLoadSpan) influentLoadSpan.textContent = `${influentLoad.toFixed(2)} kg/dia`;
        if (effluentLoadSpan) effluentLoadSpan.textContent = `${effluentLoad.toFixed(2)} kg/dia`;
        if (efficiencyLoadSpan) efficiencyLoadSpan.classList.add(window.getResultColorClass(efficiency, 'efficiency'));
        if (influentLoadSpan) influentLoadSpan.classList.add(window.getResultColorClass(0, 'organicLoad'));
        if (effluentLoadSpan) effluentLoadSpan.classList.add(window.getResultColorClass(0, 'organicLoad'));

        if (resultDisplayDiv) resultDisplayDiv.classList.remove('hidden');

        const dataToSave = {
            influentConcentration, effluentConcentration, flowRate,
            influentLoad, effluentLoad, efficiency
        };
        return dataToSave;
    };


    // Função para alternar entre as seções
    window.showSection = function(sectionId) {
        // Esconder todas as seções
        document.getElementById('sludgeAgeSection')?.classList.add('hidden-section');
        document.getElementById('physicalChemicalSection')?.classList.add('hidden-section');
        document.getElementById('organicLoadSection')?.classList.add('hidden-section');
        document.getElementById('howItWorksSection')?.classList.add('hidden-section');

        const targetSection = document.getElementById(sectionId);
        if (targetSection) {
            targetSection.classList.remove('hidden-section');
        } else {
            console.warn(`Seção com ID '${sectionId}' não encontrada.`);
            return;
        }

        // Atualizar o estilo dos botões de navegação
        const showSludgeAgeButton = document.getElementById('showSludgeAge');
        const showPhysicalChemicalButton = document.getElementById('showPhysicalChemical');
        const showOrganicLoadButton = document.getElementById('showOrganicLoad');
        const showHowItWorksButton = document.getElementById('showHowItWorks');

        // Resetar estilos de todos os botões para o estado inativo
        const allNavButtons = [showSludgeAgeButton, showPhysicalChemicalButton, showOrganicLoadButton, showHowItWorksButton];
        allNavButtons.forEach(button => {
            if (button) {
                button.classList.remove('bg-green-600', 'text-white');
                button.classList.add('bg-green-200', 'text-green-800');
            }
        });

        // Ativar o estilo do botão selecionado
        if (sectionId === 'sludgeAgeSection' && showSludgeAgeButton) {
            showSludgeAgeButton.classList.remove('bg-green-200', 'text-green-800');
            showSludgeAgeButton.classList.add('bg-green-600', 'text-white');
        } else if (sectionId === 'physicalChemicalSection' && showPhysicalChemicalButton) {
            showPhysicalChemicalButton.classList.remove('bg-green-200', 'text-green-800');
            showPhysicalChemicalButton.classList.add('bg-green-600', 'text-white');
        } else if (sectionId === 'organicLoadSection' && showOrganicLoadButton) {
            showOrganicLoadButton.classList.remove('bg-green-200', 'text-green-800');
            showOrganicLoadButton.classList.add('bg-green-600', 'text-white');
        } else if (sectionId === 'howItWorksSection' && showHowItWorksButton) {
            showHowItWorksButton.classList.remove('bg-green-200', 'text-green-800');
            showHowItWorksButton.classList.add('bg-green-600', 'text-white');
        }
    };

    // Adicionar event listeners após o DOM ser carregado
    const addEventListeners = () => {
        document.getElementById('showSludgeAge')?.addEventListener('click', () => window.showSection('sludgeAgeSection'));
        document.getElementById('showPhysicalChemical')?.addEventListener('click', () => window.showSection('physicalChemicalSection'));
        document.getElementById('showOrganicLoad')?.addEventListener('click', () => window.showSection('organicLoadSection'));
        document.getElementById('showHowItWorks')?.addEventListener('click', () => window.showSection('howItWorksSection'));

        document.getElementById('calculateButton')?.addEventListener('click', window.calculateSludgeAge);
        document.getElementById('calculatePhysicalChemical')?.addEventListener('click', window.calculatePhysicalChemicalEfficiency);
        document.getElementById('calculateOrganicLoadButton')?.addEventListener('click', window.calculateOrganicLoad);

        document.getElementById('saveSludgeAgeData')?.addEventListener('click', async () => {
            const data = await window.calculateSludgeAge();
            if (data) {
                const currentAppIdValue = firebaseConfig.projectId; // Obtém o ID do projeto da configuração
                await window.saveData('sludgeAgeCalculations', data, currentAppIdValue);
            }
        });

        document.getElementById('savePhysicalChemicalData')?.addEventListener('click', async () => {
            const data = await window.calculatePhysicalChemicalEfficiency();
            if (data) {
                const currentAppIdValue = firebaseConfig.projectId; // Obtém o ID do projeto da configuração
                await window.saveData('physicalChemicalCalculations', data, currentAppIdValue);
            }
        });

        document.getElementById('saveOrganicLoadData')?.addEventListener('click', async () => {
            const data = await window.calculateOrganicLoad();
            if (data) {
                const currentAppIdValue = firebaseConfig.projectId; // Obtém o ID do projeto da configuração
                await window.saveData('organicLoadCalculations', data, currentAppIdValue);
            }
        });

        const csvDropZone = document.getElementById('csvDropZone');
        const csvFileInput = document.getElementById('csvFile');
        const analyzeCsvButton = document.getElementById('analyzeCsvButton');

        if (analyzeCsvButton) {
            analyzeCsvButton.addEventListener('click', () => {
                if (csvFileInput && csvFileInput.files.length > 0) {
                    window.parseCSVAndFillFields(csvFileInput.files[0]);
                } else {
                    const statusDisplay = document.getElementById('csvAnalysisStatus');
                    if (statusDisplay) statusDisplay.textContent = 'Por favor, selecione um arquivo CSV primeiro ou arraste-o.';
                }
            });
        }

        if (csvDropZone) {
            csvDropZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                csvDropZone.classList.add('drag-over');
            });

            csvDropZone.addEventListener('dragleave', () => {
                csvDropZone.classList.remove('drag-over');
            });

            csvDropZone.addEventListener('drop', (e) => {
                e.preventDefault();
                csvDropZone.classList.remove('drag-over');

                const files = e.dataTransfer.files;
                if (files.length > 0 && files[0].type === 'text/csv') {
                    if (csvFileInput) csvFileInput.files = files;
                    window.parseCSVAndFillFields(files[0]);
                } else {
                    const statusDisplay = document.getElementById('csvAnalysisStatus');
                    if (statusDisplay) statusDisplay.textContent = 'Por favor, arraste um arquivo CSV válido.';
                }
            });
        }

        if (csvFileInput) {
            csvFileInput.addEventListener('change', (e) => {
                if (e.target.files.length > 0) {
                    window.parseCSVAndFillFields(e.target.files[0]);
                }
            });
        }
    };

    // Limpar os campos de entrada ao carregar a página
    const clearAllInputs = () => {
        document.getElementById('aerationTankVolume')?.value = '';
        document.getElementById('aerationTankVSS')?.value = '';
        document.getElementById('discardFlowRate')?.value = '';
        document.getElementById('discardVSS')?.value = '';
        document.getElementById('effluentFlowRate')?.value = '';
        document.getElementById('effluentVSS')?.value = '';

        document.getElementById('phyChemInitialTurbidity')?.value = '';
        document.getElementById('phyChemFinalTurbidity')?.value = '';
        document.getElementById('phyChemInitialColor')?.value = '';
        document.getElementById('phyChemFinalColor')?.value = '';
        document.getElementById('phyChemIdealDosage')?.value = '';
        document.getElementById('phyChemEtaFlowRate')?.value = '';

        document.getElementById('organicInfluentConcentration')?.value = '';
        document.getElementById('organicEffluentConcentration')?.value = '';
        document.getElementById('organicLoadFlowRate')?.value = '';
    };
    clearAllInputs();

    // Definir a seção inicial (pode ser a idade do lodo ou como funciona)
    window.showSection('sludgeAgeSection');

    // Adicionar todos os event listeners
    addEventListeners();
});

window.parseCSVAndFillFields = function(file) {
    const statusDisplay = document.getElementById('csvAnalysisStatus');
    const tableDisplay = document.getElementById('csvTableDisplay');

    if (statusDisplay) statusDisplay.textContent = '';
    if (tableDisplay) tableDisplay.innerHTML = '';

    document.getElementById('aerationTankVolume')?.value = '';
    document.getElementById('aerationTankVSS')?.value = '';
    document.getElementById('discardFlowRate')?.value = '';
    document.getElementById('discardVSS')?.value = '';
    document.getElementById('effluentFlowRate')?.value = '';
    document.getElementById('effluentVSS')?.value = '';


    if (!file) {
        if (statusDisplay) statusDisplay.textContent = 'Nenhum arquivo selecionado.';
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        const text = e.target.result;
        const lines = text.split(/\r\n|\n/).map(line => line.trim()).filter(line => line.length > 0);

        if (lines.length === 0) {
            if (statusDisplay) statusDisplay.textContent = 'Arquivo CSV vazio ou ilegível.';
            return;
        }

        const headers = lines[0].split(';').map(h => h.trim());
        const dataRows = lines.slice(1);

        let tableHtml = `<table class="min-w-full divide-y divide-gray-200"><thead><tr>`;
        headers.forEach(header => {
            tableHtml += `<th class="px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">${header}</th>`;
        });
        tableHtml += '</tr></thead><tbody class="bg-white divide-y divide-gray-200">';
        dataRows.forEach(row => {
            const values = row.split(';').map(v => v.trim());
            tableHtml += '<tr>';
            values.forEach(value => {
                tableHtml += `<td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${value}</td>`;
            });
            tableHtml += '</tr>';
        });
        tableHtml += '</tbody></table>';
        if (tableDisplay) tableDisplay.innerHTML = tableHtml;

        let aerationTankVSSValues = [];
        let discardVSSValues = [];
        let effluentVSSValue = null;

        const tanqueIndex = headers.indexOf('Tanque');
        const solidosVolateisIndex = headers.indexOf('Sólidos Voláteis mg/l');

        if (tanqueIndex === -1 || solidosVolateisIndex === -1) {
            if (statusDisplay) statusDisplay.textContent = 'CSV inválido: colunas "Tanque" ou "Sólidos Voláteis mg/l" não encontradas. Verifique os cabeçalhos.';
            return;
        }

        dataRows.forEach((row, rowIndex) => {
            const values = row.split(';').map(v => v.trim());
            if (values.length <= Math.max(tanqueIndex, solidosVolateisIndex)) {
                console.warn(`Linha ${rowIndex + 2} ignorada devido a colunas insuficientes: "${row}"`);
                return;
            }

            const tanque = values[tanqueIndex];
            const ssvString = values[solidosVolateisIndex].replace(',', '.');
            const ssv = parseFloat(ssvString);

            if (isNaN(ssv)) {
                console.warn(`Linha ${rowIndex + 2}: Valor de SSV inválido "${values[solidosVolateisIndex]}" para o tanque "${tanque}".`);
                return;
            }

            if (tanque && tanque.includes('Tanque de aeração')) {
                aerationTankVSSValues.push(ssv);
            } else if (tanque && tanque.includes('Reciclo')) {
                discardVSSValues.push(ssv);
            } else if (tanque && tanque.includes('Decantador secundário')) {
                effluentVSSValue = ssv;
            }
        });

        let warnings = [];

        if (aerationTankVSSValues.length > 0) {
            const avgAerationTankVSS = aerationTankVSSValues.reduce((sum, val) => sum + val, 0) / aerationTankVSSValues.length;
            document.getElementById('aerationTankVSS').value = avgAerationTankVSS.toFixed(2);
        } else {
            warnings.push(' "SSV no Tanque de Aeração" não encontrado ou inválido no CSV.');
        }

        if (discardVSSValues.length > 0) {
            const avgDiscardVSS = discardVSSValues.reduce((sum, val) => sum + val, 0) / discardVSSValues.length;
            document.getElementById('discardVSS').value = avgDiscardVSS.toFixed(2);
        } else {
            warnings.push(' "SSV do Lodo Descartado" (Reciclo) não encontrado ou inválido no CSV.');
        }

        if (effluentVSSValue !== null) {
            document.getElementById('effluentVSS').value = effluentVSSValue.toFixed(2);
        } else {
            warnings.push(' "SSV do Efluente Final" (Decantador secundário) não encontrado ou inválido no CSV.');
        }

        if (warnings.length > 0) {
            if (statusDisplay) statusDisplay.textContent = 'Análise do CSV concluída com avisos: ' + warnings.join('');
        } else {
            if (statusDisplay) statusDisplay.textContent = 'Dados do CSV analisados e campos preenchidos com sucesso!';
        }
    };

    reader.onerror = function() {
        if (statusDisplay) statusDisplay.textContent = 'Erro ao ler o arquivo CSV. Verifique o formato e o delimitador (ponto e vírgula).';
    };

    reader.readAsText(file);
};

import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, FontSize, FontWeight, Spacing, Radius } from '@/constants/theme';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <Text style={styles.para}>{children}</Text>;
}

function Li({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.liRow}>
      <Text style={styles.liBullet}>•</Text>
      <Text style={styles.liText}>{children}</Text>
    </View>
  );
}

export default function PrivacyPolicyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={10}>
          <MaterialIcons name="arrow-back" size={24} color={Colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Política de Privacidad</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: 40 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.appName}>OnSpace / ClipDAG</Text>
        <Text style={styles.updated}>Última actualización: 28 de junio de 2026</Text>

        {/* ── ESPAÑOL ─────────────────────────────────────────────────────── */}
        <Text style={styles.langHeader}>🇪🇸 Español</Text>

        <Section title="1. Introducción">
          <P>
            Bienvenido a OnSpace / ClipDAG ("la Aplicación", "nosotros", "nuestro"). Esta Política de Privacidad
            describe cómo recopilamos, usamos y protegemos tu información personal cuando usas nuestra
            plataforma de videos cortos y creación de contenido.
          </P>
          <P>
            Al usar la Aplicación, aceptas las prácticas descritas en esta política. Si no estás de acuerdo,
            por favor no uses la Aplicación.
          </P>
        </Section>

        <Section title="2. Información que recopilamos">
          <P>Recopilamos la siguiente información cuando usas la Aplicación:</P>
          <Li>
            <Text style={styles.bold}>Información de cuenta:</Text> Dirección de correo electrónico, nombre de
            usuario, nombre de visualización y foto de perfil.
          </Li>
          <Li>
            <Text style={styles.bold}>Contenido generado:</Text> Videos que publicas, comentarios, me gusta,
            títulos y descripciones de contenido.
          </Li>
          <Li>
            <Text style={styles.bold}>Dirección de billetera:</Text> Tu dirección de billetera blockchain
            (BlockDAG/BDAG) si conectas una billetera externa o usas la billetera interna de la app.
          </Li>
          <Li>
            <Text style={styles.bold}>Datos de uso:</Text> Interacciones con la app, videos visualizados,
            búsquedas realizadas y preferencias de configuración.
          </Li>
          <Li>
            <Text style={styles.bold}>Datos técnicos:</Text> Token de dispositivo para notificaciones push,
            sistema operativo y versión de la app.
          </Li>
          <Li>
            <Text style={styles.bold}>Mensajes directos:</Text> El contenido de tus conversaciones privadas
            almacenado de forma segura en nuestros servidores.
          </Li>
        </Section>

        <Section title="3. Cómo usamos tu información">
          <P>Usamos tu información exclusivamente para:</P>
          <Li>Proporcionar, operar y mejorar la Aplicación y sus funciones.</Li>
          <Li>Autenticar tu identidad y mantener la seguridad de tu cuenta.</Li>
          <Li>Enviarte notificaciones push sobre actividad social (likes, comentarios, seguidores, mensajes).</Li>
          <Li>Procesar transacciones de créditos BDAG internos dentro de la Aplicación.</Li>
          <Li>Personalizar tu experiencia y mostrar contenido relevante.</Li>
          <Li>Detectar y prevenir fraudes, abuso y violaciones de nuestros Términos de Servicio.</Li>
          <Li>Cumplir con obligaciones legales aplicables.</Li>
          <P style={{ marginTop: Spacing.sm }}>
            No vendemos tu información personal a terceros. No usamos tu información para publicidad
            dirigida de terceros.
          </P>
        </Section>

        <Section title="4. Terceros y proveedores de servicios">
          <P>Para operar la Aplicación, utilizamos los siguientes proveedores externos:</P>
          <Li>
            <Text style={styles.bold}>Supabase:</Text> Base de datos, autenticación y almacenamiento de archivos.
            Política de privacidad: supabase.com/privacy
          </Li>
          <Li>
            <Text style={styles.bold}>Expo / Expo Push Notifications:</Text> Infraestructura de notificaciones
            push para dispositivos iOS y Android. Política: expo.dev/privacy
          </Li>
          <Li>
            <Text style={styles.bold}>WalletConnect:</Text> Protocolo para conectar billeteras blockchain
            externas. Política: walletconnect.com/privacy
          </Li>
          <Li>
            <Text style={styles.bold}>DeepAR:</Text> Efectos de realidad aumentada en la cámara.
            Política: deepar.ai/privacy-policy
          </Li>
          <Li>
            <Text style={styles.bold}>BlockDAG Network:</Text> Red blockchain para transacciones de créditos BDAG.
          </Li>
          <P style={{ marginTop: Spacing.sm }}>
            Estos proveedores acceden a tu información únicamente en la medida necesaria para prestar sus
            servicios y están obligados contractualmente a protegerla.
          </P>
        </Section>

        <Section title="5. Almacenamiento y seguridad">
          <P>
            Tu información se almacena en servidores seguros gestionados por Supabase con cifrado en tránsito
            (TLS) y en reposo. Implementamos medidas de seguridad estándar de la industria, pero ningún sistema
            es 100% seguro. Te recomendamos usar una contraseña fuerte y mantener tu cuenta protegida.
          </P>
        </Section>

        <Section title="6. Aviso importante sobre criptomonedas (BDAG)">
          <P>
            Los créditos BDAG disponibles dentro de la Aplicación son créditos virtuales internos dentro del
            ecosistema OnSpace/ClipDAG. <Text style={styles.bold}>No constituyen moneda de curso legal, no son
            un instrumento financiero regulado, ni representan una inversión.</Text> Su valor no está garantizado
            y puede variar. No ofrecemos asesoramiento financiero.
          </P>
          <P>
            Las transferencias de BDAG dentro de la Aplicación son definitivas e irreversibles. Consulta a un
            asesor financiero antes de participar en cualquier actividad relacionada con criptomonedas.
          </P>
        </Section>

        <Section title="7. Tus derechos">
          <P>Tienes derecho a:</P>
          <Li><Text style={styles.bold}>Acceder</Text> a tu información personal almacenada.</Li>
          <Li><Text style={styles.bold}>Corregir</Text> información incorrecta desde la configuración de tu perfil.</Li>
          <Li><Text style={styles.bold}>Eliminar tu cuenta</Text> y todos tus datos asociados contactando a privacy@onspace.ai.</Li>
          <Li><Text style={styles.bold}>Exportar</Text> tus datos enviando una solicitud a privacy@onspace.ai.</Li>
          <Li><Text style={styles.bold}>Retirar tu consentimiento</Text> para notificaciones push desde la configuración de tu dispositivo.</Li>
          <P style={{ marginTop: Spacing.sm }}>
            Para ejercer estos derechos, escríbenos a: <Text style={styles.link}>privacy@onspace.ai</Text>
          </P>
        </Section>

        <Section title="8. Menores de edad">
          <P>
            La Aplicación está destinada a personas de 13 años o más. No recopilamos conscientemente información
            de menores de 13 años. Si descubrimos que hemos recopilado datos de un menor de 13 años sin
            consentimiento parental verificable, los eliminaremos de inmediato.
          </P>
        </Section>

        <Section title="9. Cambios a esta política">
          <P>
            Podemos actualizar esta Política de Privacidad periódicamente. Te notificaremos sobre cambios
            significativos a través de la Aplicación. El uso continuado de la Aplicación después de los cambios
            constituye tu aceptación de la política actualizada.
          </P>
        </Section>

        <Section title="10. Contacto">
          <P>
            Para preguntas sobre privacidad, solicitudes de datos o inquietudes:{'\n'}
            <Text style={styles.link}>privacy@onspace.ai</Text>
          </P>
        </Section>

        {/* ── ENGLISH ─────────────────────────────────────────────────────── */}
        <View style={styles.divider} />
        <Text style={styles.langHeader}>🇺🇸 English</Text>

        <Section title="1. Introduction">
          <P>
            Welcome to OnSpace / ClipDAG ("the App", "we", "our"). This Privacy Policy describes how we collect,
            use, and protect your personal information when you use our short-video and content creation platform.
          </P>
          <P>
            By using the App, you agree to the practices described in this policy. If you do not agree, please
            do not use the App.
          </P>
        </Section>

        <Section title="2. Information We Collect">
          <P>We collect the following information when you use the App:</P>
          <Li>
            <Text style={styles.bold}>Account information:</Text> Email address, username, display name, and
            profile photo.
          </Li>
          <Li>
            <Text style={styles.bold}>User-generated content:</Text> Videos you publish, comments, likes,
            captions, and content descriptions.
          </Li>
          <Li>
            <Text style={styles.bold}>Wallet address:</Text> Your blockchain wallet address (BlockDAG/BDAG)
            if you connect an external wallet or use the app's internal wallet.
          </Li>
          <Li>
            <Text style={styles.bold}>Usage data:</Text> In-app interactions, videos viewed, searches, and
            settings preferences.
          </Li>
          <Li>
            <Text style={styles.bold}>Technical data:</Text> Device push notification token, operating system,
            and app version.
          </Li>
          <Li>
            <Text style={styles.bold}>Direct messages:</Text> The content of your private conversations,
            stored securely on our servers.
          </Li>
        </Section>

        <Section title="3. How We Use Your Information">
          <P>We use your information solely to:</P>
          <Li>Provide, operate, and improve the App and its features.</Li>
          <Li>Authenticate your identity and maintain account security.</Li>
          <Li>Send push notifications about social activity (likes, comments, followers, messages).</Li>
          <Li>Process internal BDAG credit transactions within the App.</Li>
          <Li>Personalize your experience and surface relevant content.</Li>
          <Li>Detect and prevent fraud, abuse, and violations of our Terms of Service.</Li>
          <Li>Comply with applicable legal obligations.</Li>
          <P style={{ marginTop: Spacing.sm }}>
            We do not sell your personal information to third parties. We do not use your information for
            third-party targeted advertising.
          </P>
        </Section>

        <Section title="4. Third Parties and Service Providers">
          <P>To operate the App, we use the following external providers:</P>
          <Li>
            <Text style={styles.bold}>Supabase:</Text> Database, authentication, and file storage.
            Privacy policy: supabase.com/privacy
          </Li>
          <Li>
            <Text style={styles.bold}>Expo / Expo Push Notifications:</Text> Push notification infrastructure
            for iOS and Android devices. Policy: expo.dev/privacy
          </Li>
          <Li>
            <Text style={styles.bold}>WalletConnect:</Text> Protocol for connecting external blockchain wallets.
            Policy: walletconnect.com/privacy
          </Li>
          <Li>
            <Text style={styles.bold}>DeepAR:</Text> Augmented reality camera effects.
            Policy: deepar.ai/privacy-policy
          </Li>
          <Li>
            <Text style={styles.bold}>BlockDAG Network:</Text> Blockchain network for BDAG credit transactions.
          </Li>
          <P style={{ marginTop: Spacing.sm }}>
            These providers access your information only to the extent necessary to provide their services and
            are contractually obligated to protect it.
          </P>
        </Section>

        <Section title="5. Data Storage and Security">
          <P>
            Your information is stored on secure servers managed by Supabase with encryption in transit (TLS)
            and at rest. We implement industry-standard security measures, but no system is 100% secure. We
            recommend using a strong password and keeping your account protected.
          </P>
        </Section>

        <Section title="6. Important Notice About Cryptocurrency (BDAG)">
          <P>
            BDAG credits available within the App are internal virtual credits within the OnSpace/ClipDAG
            ecosystem. <Text style={styles.bold}>They do not constitute legal tender, are not a regulated
            financial instrument, and do not represent an investment.</Text> Their value is not guaranteed and
            may fluctuate. We do not provide financial advice.
          </P>
          <P>
            BDAG transfers within the App are final and irreversible. Please consult a financial advisor before
            engaging in any cryptocurrency-related activity.
          </P>
        </Section>

        <Section title="7. Your Rights">
          <P>You have the right to:</P>
          <Li><Text style={styles.bold}>Access</Text> your stored personal information.</Li>
          <Li><Text style={styles.bold}>Correct</Text> inaccurate information from your profile settings.</Li>
          <Li><Text style={styles.bold}>Delete your account</Text> and all associated data by contacting privacy@onspace.ai.</Li>
          <Li><Text style={styles.bold}>Export</Text> your data by sending a request to privacy@onspace.ai.</Li>
          <Li><Text style={styles.bold}>Withdraw consent</Text> for push notifications from your device settings.</Li>
          <P style={{ marginTop: Spacing.sm }}>
            To exercise these rights, contact us at: <Text style={styles.link}>privacy@onspace.ai</Text>
          </P>
        </Section>

        <Section title="8. Children">
          <P>
            The App is intended for users aged 13 and older. We do not knowingly collect information from
            children under 13. If we discover we have collected data from a child under 13 without verifiable
            parental consent, we will delete it immediately.
          </P>
        </Section>

        <Section title="9. Changes to This Policy">
          <P>
            We may update this Privacy Policy periodically. We will notify you of significant changes through
            the App. Continued use of the App after changes constitutes your acceptance of the updated policy.
          </P>
        </Section>

        <Section title="10. Contact">
          <P>
            For privacy questions, data requests, or concerns:{'\n'}
            <Text style={styles.link}>privacy@onspace.ai</Text>
          </P>
        </Section>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: { padding: Spacing.xs },
  headerTitle: {
    color: Colors.textPrimary,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
  },
  scroll: { flex: 1 },
  content: { padding: Spacing.lg },
  appName: {
    color: Colors.primary,
    fontSize: FontSize.xl,
    fontWeight: FontWeight.extrabold,
    textAlign: 'center',
    marginBottom: 4,
  },
  updated: {
    color: Colors.textSubtle,
    fontSize: FontSize.xs,
    textAlign: 'center',
    marginBottom: Spacing.xl,
  },
  langHeader: {
    color: Colors.textPrimary,
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    marginBottom: Spacing.md,
    marginTop: Spacing.sm,
  },
  section: { marginBottom: Spacing.xl },
  sectionTitle: {
    color: Colors.primary,
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
    marginBottom: Spacing.sm,
  },
  para: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    lineHeight: 22,
    marginBottom: Spacing.sm,
  },
  liRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 6,
    paddingLeft: 4,
  },
  liBullet: {
    color: Colors.primary,
    fontSize: FontSize.sm,
    lineHeight: 22,
    width: 12,
  },
  liText: {
    flex: 1,
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    lineHeight: 22,
  },
  bold: { fontWeight: FontWeight.semibold, color: Colors.textPrimary },
  link: { color: Colors.primary, fontWeight: FontWeight.medium },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: Spacing.xl,
  },
});

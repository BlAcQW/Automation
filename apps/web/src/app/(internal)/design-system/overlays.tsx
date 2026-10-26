'use client';

import { useState } from 'react';
import { Button, ConfirmDialog, Drawer, Input, Modal, TickPop } from '@bookingflow/ui';
import { notify } from '@/components/brand/toast';
import { Row, Section } from './section';

export function OverlaysSection() {
    const [modal, setModal] = useState(false);
    const [drawer, setDrawer] = useState(false);
    const [confirm, setConfirm] = useState(false);
    const [tick, setTick] = useState(0);

    return (
        <Section title="Overlays, toasts and success" description="Backdrop fades, panel slides. Destructive actions always confirm.">
            <Row label="Open">
                <Button variant="secondary" onClick={() => setModal(true)}>Modal</Button>
                <Button variant="secondary" onClick={() => setDrawer(true)}>Drawer</Button>
                <Button variant="destructive" onClick={() => setConfirm(true)}>Delete service</Button>
            </Row>
            <Row label="Toasts">
                <Button variant="ghost" onClick={() => notify.success('Booking saved')}>Success toast</Button>
                <Button variant="ghost" onClick={() => notify.error()}>Error toast</Button>
                <Button variant="ghost" onClick={() => notify.info('Ama replied to your message')}>Info toast</Button>
            </Row>
            <Row label="TickPop (booking confirmed, order paid, settings saved)">
                <TickPop key={tick} label="Booking confirmed" />
                <TickPop key={`s${tick}`} size={32} label="Saved" />
                <Button variant="secondary" size="sm" onClick={() => setTick((n) => n + 1)}>Replay</Button>
            </Row>

            <Modal
                isOpen={modal}
                onClose={() => setModal(false)}
                title="Add a service"
                description="Customers will see this when they book."
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setModal(false)}>Cancel</Button>
                        <Button onClick={() => setModal(false)}>Save service</Button>
                    </>
                }
            >
                <div className="space-y-4">
                    <Input label="Service name" placeholder="Braids" />
                    <Input label="How long (minutes)" type="number" defaultValue={60} />
                </div>
            </Modal>
            <Drawer isOpen={drawer} onClose={() => setDrawer(false)} title="Booking details" footer={<Button onClick={() => setDrawer(false)}>Done</Button>}>
                <p className="text-[15px] text-muted">Ama Mensah · Braids · Today, 10:00</p>
            </Drawer>
            <ConfirmDialog
                isOpen={confirm}
                onClose={() => setConfirm(false)}
                onConfirm={() => setConfirm(false)}
                title="Delete this service?"
                description="Customers won't be able to book Braids any more. Past bookings stay in your history."
                confirmLabel="Delete service"
            />
        </Section>
    );
}
